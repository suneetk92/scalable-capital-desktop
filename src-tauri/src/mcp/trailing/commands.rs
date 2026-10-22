//! What the webview can call: list, add and remove a stop, and set the check interval.

use super::{
    announce_change, quotes::quote_prices, watcher, Status, Trail, TrailingState, TrailingStop,
    MAX_CHECK_SECONDS, MAX_NAME, MAX_STOPS, MIN_CHECK_SECONDS,
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

fn valid_trail(trail: Trail, price: f64) -> Result<(), String> {
    match trail {
        Trail::Percent(percent) if percent.is_finite() && percent > 0.0 && percent < 100.0 => {
            Ok(())
        }
        Trail::Percent(_) => {
            Err("The trailing distance must be above 0 and below 100 percent".to_owned())
        }
        Trail::Amount(amount) if amount.is_finite() && amount > 0.0 && amount < price => Ok(()),
        Trail::Amount(_) => {
            Err("The trailing distance must be above zero and below the current price".to_owned())
        }
    }
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
pub struct TrailingList {
    stops: Vec<TrailingStop>,
    problem: Option<String>,
}

#[tauri::command]
pub fn list_trailing_stops(state: State<'_, TrailingState>) -> TrailingList {
    TrailingList {
        stops: state.snapshot(),
        problem: state.problem(),
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
    pub isin: String,
    pub name: String,
    #[serde(default)]
    pub portfolio_id: Option<String>,
    pub shares: f64,
    pub trail: Trail,
}

fn is_duplicate(stops: &[TrailingStop], isin: &str, portfolio_id: &Option<String>) -> bool {
    stops.iter().any(|stop| {
        stop.status == Status::Active && stop.isin == isin && stop.portfolio_id == *portfolio_id
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
    if !request.shares.is_finite() || request.shares <= 0.0 {
        return Err("The number of shares must be greater than zero".to_owned());
    }
    let portfolio_id = request.portfolio_id.clone().filter(|id| !id.is_empty());
    let (count, exists) = state.mutate(|stops| {
        (
            stops.len(),
            is_duplicate(stops, &request.isin, &portfolio_id),
        )
    });
    if exists {
        return Err(
            "There is already a trailing stop for this security. Remove it first.".to_owned(),
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
        .and_then(|(_, price)| *price)
        .ok_or("Scalable gave no price for this security, so the stop cannot start.")?;
    valid_trail(request.trail, price)?;
    let name: String = request.name.trim().chars().take(MAX_NAME).collect();
    let stop = TrailingStop {
        id: format!("{:016x}", rand::random::<u64>()),
        isin: request.isin.clone(),
        name: if name.is_empty() {
            request.isin.clone()
        } else {
            name
        },
        portfolio_id: portfolio_id.clone(),
        shares: request.shares,
        trail: request.trail,
        start_price: price,
        high: price,
        last_price: Some(price),
        status: Status::Active,
        message: None,
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default(),
    };
    // Trading may have been switched off while the price loaded, and the same stop twice is refused again.
    let added = state.mutate(|stops| {
        if !gate.is_on() || is_duplicate(stops, &request.isin, &portfolio_id) {
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
            isin: isin.to_owned(),
            name: "Test".to_owned(),
            portfolio_id: Some("p-1".to_owned()),
            shares: 2.0,
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
        gate.enabled.store(false, Ordering::SeqCst);
        assert_eq!(
            admit_new_stop(&gate, &state, &request).unwrap_err(),
            TRADING_OFF
        );
    }

    #[test]
    fn the_trail_must_fit_the_price() {
        assert!(valid_trail(Trail::Percent(5.0), 100.0).is_ok());
        assert!(valid_trail(Trail::Percent(0.0), 100.0).is_err());
        assert!(valid_trail(Trail::Percent(100.0), 100.0).is_err());
        assert!(valid_trail(Trail::Percent(f64::NAN), 100.0).is_err());
        assert!(valid_trail(Trail::Amount(5.0), 100.0).is_ok());
        assert!(valid_trail(Trail::Amount(100.0), 100.0).is_err());
        assert!(valid_trail(Trail::Amount(-1.0), 100.0).is_err());
    }
}
