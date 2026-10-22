//! What the webview can call: list, add, change and remove a stop, and set the check interval.

use super::{
    announce_change, quotes::quote_prices, watcher, Side, Status, Trail, TrailingState,
    TrailingStop, MAX_CHECK_SECONDS, MAX_NAME, MAX_STOPS, MIN_CHECK_SECONDS,
};
use crate::mcp::{
    args::is_isin,
    trading::{TradingGate, TRADING_OFF},
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

/// The size of a stop: the shares to sell, or the money to spend on a purchase.
fn valid_size(side: Side, size: f64) -> Result<(), String> {
    if size.is_finite() && size > 0.0 {
        return Ok(());
    }
    Err(match side {
        Side::Sell => "The number of shares must be greater than zero".to_owned(),
        Side::Buy => "The amount to spend must be greater than zero".to_owned(),
    })
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
    /// The shares to sell (a stop loss).
    #[serde(default)]
    pub shares: f64,
    /// The money to spend (a buy stop).
    #[serde(default)]
    pub amount: f64,
    pub trail: Trail,
}

impl NewTrailingStop {
    fn size(&self) -> f64 {
        match self.side {
            Side::Sell => self.shares,
            Side::Buy => self.amount,
        }
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

/// Everything `add_trailing_stop` checks before it asks Scalable for a price: the Trading switch,
/// the request itself, and that the stop is neither a duplicate nor one too many. Returns the
/// portfolio id the stop belongs to.
fn admit_new_stop(
    gate: &TradingGate,
    state: &TrailingState,
    request: &NewTrailingStop,
) -> Result<Option<String>, String> {
    if !gate.is_on() {
        return Err(TRADING_OFF.to_owned());
    }
    if !is_isin(&request.isin) {
        return Err("A valid 12-character ISIN is required".to_owned());
    }
    valid_size(request.side, request.size())?;
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
        shares: if request.side == Side::Sell {
            request.shares
        } else {
            0.0
        },
        amount: (request.side == Side::Buy).then_some(request.amount),
        trail: request.trail,
        start_price: price,
        high: price,
        last_price: Some(price),
        status: Status::Active,
        message: None,
        sold_price: None,
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default(),
    };
    // Trading may have been switched off while the price loaded, and the same stop twice is refused again.
    let added = state.mutate(|stops| {
        if !gate.is_on() || is_duplicate(stops, request.side, &request.isin, &portfolio_id) {
            return false;
        }
        stops.push(stop.clone());
        true
    });
    if !added {
        return Err(format!("{TRADING_OFF} No trailing stop was added."));
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
    /// The shares of a stop loss, or the money of a buy stop.
    pub size: f64,
    pub trail: Trail,
}

/// Changes the size (shares or money) and the distance of a stop that is watching, or one that needs the user, which then
/// watches again. A watching stop keeps its high; one that needs the user starts over from the last price,
/// because the old high is what triggered it. It changes what the app sells, so it needs the Trading switch.
#[tauri::command]
pub fn update_trailing_stop(
    app: AppHandle,
    gate: State<'_, TradingGate>,
    state: State<'_, TrailingState>,
    request: TrailingStopChange,
) -> Result<TrailingStop, String> {
    if !gate.is_on() {
        return Err(TRADING_OFF.to_owned());
    }
    let (previous, updated) = state.mutate(|stops| {
        let stop = stops
            .iter_mut()
            .find(|stop| stop.id == request.id)
            .ok_or("This trailing stop no longer exists.".to_owned())?;
        if !matches!(stop.status, Status::Active | Status::Attention) {
            return Err("Only a stop that is watching or needs you can be changed.".to_owned());
        }
        valid_size(stop.side, request.size)?;
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
        match stop.side {
            Side::Sell => stop.shares = request.size,
            Side::Buy => stop.amount = Some(request.size),
        }
        stop.trail = request.trail;
        stop.message = None;
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
            shares: 2.0,
            amount: 0.0,
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
            TRADING_OFF
        );
        gate.enabled.store(true, Ordering::SeqCst);
        assert_eq!(
            admit_new_stop(&gate, &state, &request).unwrap(),
            Some("p-1".to_owned())
        );
        assert!(admit_new_stop(&gate, &state, &new_stop("nope")).is_err());
        let mut none = new_stop("US0378331005");
        none.shares = 0.0;
        assert!(admit_new_stop(&gate, &state, &none).is_err());
        let mut buy = new_stop("US0378331005");
        buy.side = Side::Buy;
        assert!(admit_new_stop(&gate, &state, &buy).is_err());
        buy.amount = 100.0;
        assert!(admit_new_stop(&gate, &state, &buy).is_ok());
        gate.enabled.store(false, Ordering::SeqCst);
        assert_eq!(
            admit_new_stop(&gate, &state, &request).unwrap_err(),
            TRADING_OFF
        );
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
