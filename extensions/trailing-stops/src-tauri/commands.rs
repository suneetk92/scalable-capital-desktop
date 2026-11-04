//! What the webview can call: list, add, change and remove a stop, and set the check interval.

use super::{
    announce_change, quotes::quote_prices, watcher, Side, Status, Trail, TrailingState,
    TrailingStop, MAX_CHECK_SECONDS, MAX_NAME, MAX_STOPS, MIN_CHECK_SECONDS,
};
use crate::mcp::{
    args::is_isin,
    trading::{TradingGate, MANAGE_OFF},
};
use serde::{Deserialize, Serialize};
use std::{
    sync::atomic::Ordering,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, State};

fn valid_trail(side: Side, trail: Trail, price: f64) -> Result<(), String> {
    match trail {
        Trail::Percent(percent) if percent.is_finite() && percent > 0.0 && percent < 100.0 => {
            Ok(())
        }
        Trail::Percent(_) => {
            Err("The trailing distance must be above 0 and below 100 percent".to_owned())
        }
        // A sale cannot trail by more than the price; a purchase has no such ceiling.
        Trail::Amount(amount)
            if amount.is_finite() && amount > 0.0 && (side == Side::Buy || amount < price) =>
        {
            Ok(())
        }
        Trail::Amount(_) => {
            Err("The trailing distance must be above zero and below the current price".to_owned())
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum StopSize {
    Amount(f64),
    Shares(f64),
}

fn valid_size(side: Side, size: StopSize) -> Result<(), String> {
    let (value, label) = match size {
        StopSize::Amount(value) => (value, "amount to spend"),
        StopSize::Shares(value) => (value, "number of shares"),
    };
    if !value.is_finite() || value <= 0.0 {
        return Err(format!("The {label} must be greater than zero"));
    }
    if side == Side::Buy && matches!(size, StopSize::Shares(value) if value.fract() != 0.0) {
        return Err("A buy stop needs a whole number of shares".to_owned());
    }
    Ok(())
}

fn requested_size(
    side: Side,
    amount: Option<f64>,
    shares: Option<f64>,
) -> Result<StopSize, String> {
    let size = match (side, amount, shares) {
        (Side::Sell, None, Some(shares)) => StopSize::Shares(shares),
        (Side::Buy, Some(amount), None) => StopSize::Amount(amount),
        (Side::Buy, None, Some(shares)) => StopSize::Shares(shares),
        (_, Some(_), Some(_)) => {
            return Err("Choose either an amount or a number of shares, not both".to_owned())
        }
        (Side::Sell, Some(_), None) => {
            return Err("A trailing stop loss can only use a number of shares".to_owned())
        }
        (_, None, None) => return Err("Choose an amount or a number of shares".to_owned()),
    };
    valid_size(side, size)?;
    Ok(size)
}

/// Sets the seconds between price checks (the app's setting), within the allowed bounds.
#[tauri::command]
pub fn set_trailing_interval(state: State<'_, TrailingState>, seconds: u64) {
    state.check_seconds.store(
        seconds.clamp(MIN_CHECK_SECONDS, MAX_CHECK_SECONDS),
        Ordering::Relaxed,
    );
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrailingList {
    stops: Vec<TrailingStop>,
    problem: Option<String>,
    last_checked: Option<u64>,
}

#[tauri::command]
pub fn list_trailing_stops(state: State<'_, TrailingState>) -> TrailingList {
    TrailingList {
        stops: state.snapshot(),
        problem: state.problem(),
        last_checked: state.last_checked(),
    }
}

/// The Refresh button: one price check now, the same pass the watcher runs on its timer (it
/// never sells with Trading off), instead of waiting out the interval. Nothing is checked while no stop is active.
#[tauri::command]
pub async fn check_trailing_stops_now(
    app: AppHandle,
    state: State<'_, TrailingState>,
) -> Result<(), String> {
    if state.watching() {
        watcher::check(&app).await;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTrailingStop {
    #[serde(default)]
    pub side: Side,
    pub isin: String,
    pub name: String,
    #[serde(default)]
    pub portfolio_id: Option<String>,
    /// The shares to sell, or the shares to buy.
    #[serde(default)]
    pub shares: Option<f64>,
    /// The money to spend on a buy stop.
    #[serde(default)]
    pub amount: Option<f64>,
    pub trail: Trail,
}

impl NewTrailingStop {
    fn size(&self) -> Result<StopSize, String> {
        requested_size(self.side, self.amount, self.shares)
    }
}

fn is_duplicate(
    stops: &[TrailingStop],
    side: Side,
    isin: &str,
    portfolio_id: &Option<String>,
) -> bool {
    stops.iter().any(|stop| {
        stop.status == Status::Active
            && stop.side == side
            && stop.isin == isin
            && stop.portfolio_id == *portfolio_id
    })
}

/// Everything `add_trailing_stop` checks before it asks Scalable for a price: the access level,
/// the request itself, and that the stop is neither a duplicate nor one too many. Returns the
/// portfolio id the stop belongs to.
fn admit_new_stop(
    gate: &TradingGate,
    state: &TrailingState,
    request: &NewTrailingStop,
) -> Result<Option<String>, String> {
    if !gate.manage_on() {
        return Err(MANAGE_OFF.to_owned());
    }
    if !is_isin(&request.isin) {
        return Err("A valid 12-character ISIN is required".to_owned());
    }
    request.size()?;
    let portfolio_id = request.portfolio_id.clone().filter(|id| !id.is_empty());
    let (count, exists) = state.mutate(|stops| {
        (
            stops.len(),
            is_duplicate(stops, request.side, &request.isin, &portfolio_id),
        )
    });
    if exists {
        return Err(
            "There is already a trailing stop of this kind for this security. Edit or remove it first.".to_owned(),
        );
    }
    if count >= MAX_STOPS {
        return Err("Too many trailing stops. Remove some first.".to_owned());
    }
    Ok(portfolio_id)
}

#[tauri::command]
pub async fn add_trailing_stop(
    app: AppHandle,
    gate: State<'_, TradingGate>,
    state: State<'_, TrailingState>,
    request: NewTrailingStop,
) -> Result<TrailingStop, String> {
    let portfolio_id = admit_new_stop(&gate, &state, &request)?;
    let size = request.size()?;
    let prices = quote_prices(&app, vec![(request.isin.clone(), portfolio_id.clone())]).await?;
    let price = prices
        .first()
        .and_then(|(_, quote)| quote.for_side(request.side))
        .ok_or("Scalable gave no price for this security, so the stop cannot start.")?;
    valid_trail(request.side, request.trail, price)?;
    let name: String = request.name.trim().chars().take(MAX_NAME).collect();
    let stop = TrailingStop {
        side: request.side,
        id: format!("{:016x}", rand::random::<u64>()),
        isin: request.isin.clone(),
        name: if name.is_empty() {
            request.isin.clone()
        } else {
            name
        },
        portfolio_id: portfolio_id.clone(),
        shares: match size {
            StopSize::Shares(shares) => shares,
            StopSize::Amount(_) => 0.0,
        },
        amount: match size {
            StopSize::Amount(amount) => Some(amount),
            StopSize::Shares(_) => None,
        },
        trail: request.trail,
        start_price: price,
        high: price,
        last_price: Some(price),
        status: Status::Active,
        message: None,
        attempts: 0,
        trigger_reached: false,
        sold_price: None,
        executed_at: None,
        receipt: None,
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default(),
    };
    // Trading may have been switched off while the price loaded, and the same stop twice is refused again.
    let added = state.mutate(|stops| {
        if !gate.manage_on() || is_duplicate(stops, request.side, &request.isin, &portfolio_id) {
            return false;
        }
        stops.push(stop.clone());
        true
    });
    if !added {
        return Err(format!("{MANAGE_OFF} No trailing stop was added."));
    }
    if let Err(error) = state.persist(&app) {
        state.mutate(|stops| stops.retain(|item| item.id != stop.id));
        return Err(error);
    }
    state.wake();
    announce_change(&app);
    Ok(stop)
}

#[derive(Deserialize)]
pub struct TrailingStopChange {
    pub id: String,
    /// The old edit field. When present without explicit fields, a buy stop keeps its existing mode.
    #[serde(default)]
    pub size: Option<f64>,
    /// An explicit amount, for a buy stop.
    #[serde(default)]
    pub amount: Option<f64>,
    /// An explicit number of shares, for either side.
    #[serde(default)]
    pub shares: Option<f64>,
    pub trail: Trail,
}

fn changed_size(request: &TrailingStopChange, stop: &TrailingStop) -> Result<StopSize, String> {
    if request.size.is_some() && (request.amount.is_some() || request.shares.is_some()) {
        return Err(
            "Use the legacy size field or an explicit amount or shares field, not both".to_owned(),
        );
    }
    if let Some(size) = request.size {
        return match stop.side {
            Side::Sell => {
                valid_size(stop.side, StopSize::Shares(size))?;
                Ok(StopSize::Shares(size))
            }
            Side::Buy if stop.amount.is_some() => {
                valid_size(stop.side, StopSize::Amount(size))?;
                Ok(StopSize::Amount(size))
            }
            Side::Buy => {
                valid_size(stop.side, StopSize::Shares(size))?;
                Ok(StopSize::Shares(size))
            }
        };
    }
    requested_size(stop.side, request.amount, request.shares)
}

/// Changes the size (shares or money) and the distance of a stop that is watching, or one that needs the user, which then
/// watches again. A watching stop keeps its high; one that needs the user starts over from the last price,
/// because the old high is what triggered it. Changing a stop places no order (the watcher still needs Full access to act), so Restricted access is enough.
#[tauri::command]
pub fn update_trailing_stop(
    app: AppHandle,
    gate: State<'_, TradingGate>,
    state: State<'_, TrailingState>,
    request: TrailingStopChange,
) -> Result<TrailingStop, String> {
    if !gate.manage_on() {
        return Err(MANAGE_OFF.to_owned());
    }
    let (previous, updated) = state.mutate(|stops| {
        let stop = stops
            .iter_mut()
            .find(|stop| stop.id == request.id)
            .ok_or("This trailing stop no longer exists.".to_owned())?;
        if !matches!(stop.status, Status::Active | Status::Attention) {
            return Err("Only a stop that is watching or needs you can be changed.".to_owned());
        }
        let size = changed_size(&request, stop)?;
        let high = if stop.status == Status::Attention {
            stop.last_price
                .filter(|price| *price > 0.0)
                .unwrap_or(stop.high)
        } else {
            stop.high
        };
        valid_trail(stop.side, request.trail, high)?;
        let previous = stop.clone();
        stop.high = high;
        stop.status = Status::Active;
        match size {
            StopSize::Shares(shares) => {
                stop.shares = shares;
                stop.amount = None;
            }
            StopSize::Amount(amount) => {
                stop.shares = 0.0;
                stop.amount = Some(amount);
            }
        }
        stop.trail = request.trail;
        stop.message = None;
        stop.attempts = 0;
        stop.trigger_reached = false;
        Ok((previous, stop.clone()))
    })?;
    if let Err(error) = state.persist(&app) {
        state.mutate(|stops| {
            if let Some(stop) = stops.iter_mut().find(|stop| stop.id == previous.id) {
                *stop = previous;
            }
        });
        return Err(error);
    }
    state.wake();
    announce_change(&app);
    Ok(updated)
}

/// Needs no Trading switch: removing a stop only stops the app from selling.
#[tauri::command]
pub fn remove_trailing_stop(
    app: AppHandle,
    state: State<'_, TrailingState>,
    id: String,
) -> Result<(), String> {
    let removed = state.mutate(|stops| {
        if stops
            .iter()
            .any(|stop| stop.id == id && stop.status == Status::Selling)
        {
            return Err("This stop is being sold right now.".to_owned());
        }
        stops.retain(|stop| stop.id != id);
        Ok(())
    });
    removed?;
    let saved = state.persist(&app);
    announce_change(&app);
    saved
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_stop(isin: &str) -> NewTrailingStop {
        NewTrailingStop {
            side: Side::Sell,
            isin: isin.to_owned(),
            name: "Test".to_owned(),
            portfolio_id: Some("p-1".to_owned()),
            shares: Some(2.0),
            amount: None,
            trail: Trail::Percent(5.0),
        }
    }

    /// The add command is refused before any price is fetched while Trading is off, admitted once
    /// it is on, and refused again after the switch goes off.
    #[test]
    fn adding_a_stop_is_blocked_off_and_allowed_on() {
        let gate = TradingGate::default();
        let state = TrailingState::default();
        let request = new_stop("US0378331005");
        assert_eq!(
            admit_new_stop(&gate, &state, &request).unwrap_err(),
            MANAGE_OFF
        );
        gate.set_for_test(true);
        assert_eq!(
            admit_new_stop(&gate, &state, &request).unwrap(),
            Some("p-1".to_owned())
        );
        assert!(admit_new_stop(&gate, &state, &new_stop("nope")).is_err());
        let mut none = new_stop("US0378331005");
        none.shares = Some(0.0);
        assert!(admit_new_stop(&gate, &state, &none).is_err());
        let mut buy = new_stop("US0378331005");
        buy.side = Side::Buy;
        buy.shares = None;
        assert!(admit_new_stop(&gate, &state, &buy).is_err());
        buy.amount = Some(100.0);
        assert!(admit_new_stop(&gate, &state, &buy).is_ok());
        gate.set_for_test(false);
        assert_eq!(
            admit_new_stop(&gate, &state, &request).unwrap_err(),
            MANAGE_OFF
        );
    }

    #[test]
    fn buy_stop_sizes_are_exclusive_and_share_counts_are_whole() {
        let mut buy = new_stop("US0378331005");
        buy.side = Side::Buy;
        buy.shares = Some(3.0);
        assert_eq!(buy.size(), Ok(StopSize::Shares(3.0)));
        buy.shares = Some(2.5);
        assert!(buy.size().unwrap_err().contains("whole number"));
        buy.shares = Some(3.0);
        buy.amount = Some(100.0);
        assert!(buy.size().unwrap_err().contains("not both"));
        buy.amount = None;
        buy.shares = None;
        assert!(buy.size().is_err());
    }

    #[test]
    fn legacy_add_and_edit_requests_still_deserialize() {
        let legacy_add: NewTrailingStop = serde_json::from_value(serde_json::json!({
            "side": "buy",
            "isin": "US0378331005",
            "name": "Test",
            "portfolioId": "p-1",
            "amount": 250.0,
            "trail": { "kind": "percent", "value": 5.0 }
        }))
        .unwrap();
        assert_eq!(legacy_add.size(), Ok(StopSize::Amount(250.0)));

        let mut stop = crate::ext_trailing_stops::sample_stop(Trail::Percent(5.0), 100.0);
        stop.side = Side::Buy;
        stop.shares = 0.0;
        stop.amount = Some(250.0);
        let legacy_edit: TrailingStopChange = serde_json::from_value(serde_json::json!({
            "id": stop.id.clone(),
            "size": 300.0,
            "trail": { "kind": "percent", "value": 5.0 }
        }))
        .unwrap();
        assert_eq!(
            changed_size(&legacy_edit, &stop),
            Ok(StopSize::Amount(300.0))
        );
    }

    #[test]
    fn edits_keep_legacy_mode_and_can_explicitly_change_buy_mode() {
        let mut stop = crate::ext_trailing_stops::sample_stop(Trail::Percent(5.0), 100.0);
        stop.side = Side::Buy;
        stop.shares = 0.0;
        stop.amount = Some(250.0);
        let legacy = TrailingStopChange {
            id: stop.id.clone(),
            size: Some(300.0),
            amount: None,
            shares: None,
            trail: Trail::Percent(5.0),
        };
        assert_eq!(changed_size(&legacy, &stop), Ok(StopSize::Amount(300.0)));
        let shares = TrailingStopChange {
            size: None,
            amount: None,
            shares: Some(3.0),
            ..legacy
        };
        assert_eq!(changed_size(&shares, &stop), Ok(StopSize::Shares(3.0)));
        let back_to_amount = TrailingStopChange {
            size: None,
            amount: Some(150.0),
            shares: None,
            ..shares
        };
        assert_eq!(
            changed_size(&back_to_amount, &stop),
            Ok(StopSize::Amount(150.0))
        );
        let fractional = TrailingStopChange {
            size: None,
            amount: None,
            shares: Some(1.5),
            ..back_to_amount
        };
        assert!(changed_size(&fractional, &stop).is_err());
    }

    #[test]
    fn the_trail_must_fit_the_price() {
        let sell = |trail, price| valid_trail(Side::Sell, trail, price);
        assert!(sell(Trail::Percent(5.0), 100.0).is_ok());
        assert!(sell(Trail::Percent(0.0), 100.0).is_err());
        assert!(sell(Trail::Percent(100.0), 100.0).is_err());
        assert!(sell(Trail::Percent(f64::NAN), 100.0).is_err());
        assert!(sell(Trail::Amount(5.0), 100.0).is_ok());
        assert!(sell(Trail::Amount(100.0), 100.0).is_err());
        assert!(sell(Trail::Amount(-1.0), 100.0).is_err());
    }

    #[test]
    fn a_buy_stop_may_trail_by_more_than_the_price() {
        assert!(valid_trail(Side::Buy, Trail::Amount(150.0), 100.0).is_ok());
        assert!(valid_trail(Side::Buy, Trail::Amount(0.0), 100.0).is_err());
        assert!(valid_trail(Side::Buy, Trail::Percent(100.0), 100.0).is_err());
    }
}
