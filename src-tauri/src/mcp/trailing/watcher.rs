//! The price checks. They run only while at least one stop is active: with none, the watcher
//! waits for a wake-up (a stop was added, or the saved stops were loaded) and does not tick.

use super::{
    announce_change, orders::execute, quotes::quote_prices, Side, Status, Trail, TrailingState,
    TrailingStop,
};
use crate::mcp::trading::TradingGate;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// The price at which the stop trades: at or below it for a sale, at or above it for a purchase.
pub(super) fn trigger_price(side: Side, extreme: f64, trail: Trail) -> f64 {
    match (side, trail) {
        (Side::Sell, Trail::Percent(percent)) => extreme * (1.0 - percent / 100.0),
        (Side::Sell, Trail::Amount(amount)) => extreme - amount,
        (Side::Buy, Trail::Percent(percent)) => extreme * (1.0 + percent / 100.0),
        (Side::Buy, Trail::Amount(amount)) => extreme + amount,
    }
}

/// Records the latest price, moves the extreme (the high of a sale, the low of a purchase) when it is a new one, and says whether the stop is hit.
fn advance(stop: &mut TrailingStop, price: f64) -> bool {
    stop.last_price = Some(price);
    match stop.side {
        Side::Sell if price > stop.high => stop.high = price,
        Side::Buy if price < stop.high => stop.high = price,
        _ => {}
    }
    let trigger = trigger_price(stop.side, stop.high, stop.trail);
    match stop.side {
        Side::Sell => price <= trigger,
        Side::Buy => price >= trigger,
    }
}

/// Whether the watcher has anything to do: only an active stop is ever checked.
pub(super) fn should_watch(stops: &[TrailingStop]) -> bool {
    stops.iter().any(|stop| stop.status == Status::Active)
}

/// Sets the problem line and tells the webview when it changed.
fn report(app: &AppHandle, state: &TrailingState, problem: Option<String>) {
    if state.set_problem(problem) {
        announce_change(app);
    }
}

/// With Trading off nothing is watched or traded, but the shown price still follows the market: the high
/// and the status stay as they are, and nothing is saved.
async fn show_prices(
    app: &AppHandle,
    state: &TrailingState,
    targets: Vec<(String, Option<String>)>,
) {
    let Ok(prices) = quote_prices(app, targets).await else {
        return;
    };
    let changed = state.mutate(|stops| {
        let mut changed = false;
        for stop in stops
            .iter_mut()
            .filter(|stop| stop.status == Status::Active)
        {
            let price = prices
                .iter()
                .find(|(isin, _)| *isin == stop.isin)
                .and_then(|(_, quote)| quote.for_side(stop.side));
            if price.is_some() && price != stop.last_price {
                stop.last_price = price;
                changed = true;
            }
        }
        changed
    });
    if changed {
        announce_change(app);
    }
}

/// One pass: reads the prices of the active stops, moves their highs up (or lows down) and trades the ones that were hit.
pub(super) async fn check(app: &AppHandle) {
    run_check(app).await;
    app.state::<TrailingState>().stamp_check();
    super::announce_change(app);
}

async fn run_check(app: &AppHandle) {
    let gate = app.state::<TradingGate>();
    let state = app.state::<TrailingState>();
    let trading = gate.is_on();
    let mut targets: Vec<(String, Option<String>)> = Vec::new();
    for stop in state
        .snapshot()
        .iter()
        .filter(|stop| stop.status == Status::Active)
    {
        if !targets.iter().any(|(isin, _)| *isin == stop.isin) {
            targets.push((stop.isin.clone(), stop.portfolio_id.clone()));
        }
    }
    if targets.is_empty() {
        report(app, &state, None);
        return;
    }
    if !trading {
        show_prices(app, &state, targets).await;
        return;
    }
    let prices = match quote_prices(app, targets).await {
        Ok(prices) => prices,
        Err(error) => {
            report(app, &state, Some(format!("Could not read prices: {error}")));
            return;
        }
    };
    let missing: Vec<&str> = prices
        .iter()
        .filter(|(_, quote)| quote.sell.is_none())
        .map(|(isin, _)| isin.as_str())
        .collect();
    report(
        app,
        &state,
        (!missing.is_empty())
            .then(|| format!("No price from Scalable for {}.", missing.join(", "))),
    );
    // Trading may have been switched off while the prices were loading.
    if !gate.is_on() {
        return;
    }
    let (hits, changed) = state.mutate(|stops| {
        let mut hits = Vec::new();
        let mut changed = false;
        for stop in stops
            .iter_mut()
            .filter(|stop| stop.status == Status::Active)
        {
            let Some(price) = prices
                .iter()
                .find(|(isin, _)| *isin == stop.isin)
                .and_then(|(_, quote)| quote.for_side(stop.side))
            else {
                continue;
            };
            let high = stop.high;
            let last = stop.last_price;
            if advance(stop, price) {
                stop.status = Status::Selling;
                hits.push(stop.clone());
                changed = true;
            }
            changed |= stop.high != high || stop.last_price != last;
        }
        (hits, changed)
    });
    if changed {
        // A stop must be saved as selling before anything is sent, so a crash cannot repeat the sale.
        if let Err(error) = state.persist(app) {
            if !hits.is_empty() {
                state.mutate(|stops| {
                    for stop in stops
                        .iter_mut()
                        .filter(|stop| stop.status == Status::Selling)
                    {
                        stop.status = Status::Attention;
                        stop.message = Some(format!(
                            "Nothing was sent, because the stop could not be saved: {error}"
                        ));
                    }
                });
                announce_change(app);
                return;
            }
            state.set_problem(Some(error));
        }
        announce_change(app);
    }
    for stop in hits {
        execute(app, stop).await;
    }
}

/// Starts the watcher. It idles until a stop is active and idles again when none is left.
pub(super) fn spawn(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let state = app.state::<TrailingState>();
            if !state.watching() {
                // Nothing is watched, so a price problem from before is stale.
                report(&app, &state, None);
                state.wake.notified().await;
                continue;
            }
            // Waits in short steps, so a changed setting applies without waiting out the old interval.
            let mut waited = 0;
            while waited < state.check_seconds() && state.watching() {
                tokio::time::sleep(Duration::from_secs(1)).await;
                waited += 1;
            }
            if state.watching() {
                check(&app).await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::trailing::sample_stop;

    #[test]
    fn the_trigger_is_below_the_high_by_the_trail() {
        assert_eq!(
            trigger_price(Side::Sell, 200.0, Trail::Percent(10.0)),
            180.0
        );
        assert_eq!(trigger_price(Side::Sell, 200.0, Trail::Amount(15.0)), 185.0);
        assert_eq!(trigger_price(Side::Buy, 200.0, Trail::Percent(25.0)), 250.0);
        assert_eq!(trigger_price(Side::Buy, 200.0, Trail::Amount(15.0)), 215.0);
    }

    #[test]
    fn the_high_only_moves_up_and_the_stop_follows_it() {
        let mut stop = sample_stop(Trail::Percent(10.0), 100.0);
        assert!(!advance(&mut stop, 120.0));
        assert_eq!(stop.high, 120.0);
        assert!(!advance(&mut stop, 109.0));
        assert_eq!(stop.high, 120.0);
        assert_eq!(stop.last_price, Some(109.0));
        assert!(advance(&mut stop, 108.0));
        assert!(advance(&mut stop, 90.0));
    }

    #[test]
    fn a_buy_stop_follows_the_low_down_and_buys_on_the_rise() {
        let mut stop = sample_stop(Trail::Percent(10.0), 100.0);
        stop.side = Side::Buy;
        assert!(!advance(&mut stop, 80.0));
        assert_eq!(stop.high, 80.0);
        assert!(!advance(&mut stop, 87.0));
        assert_eq!(stop.high, 80.0);
        assert_eq!(stop.last_price, Some(87.0));
        assert!(advance(&mut stop, 88.0));
        assert!(advance(&mut stop, 95.0));
        assert!(!advance(&mut stop, 70.0));
        assert_eq!(stop.high, 70.0);
    }

    #[test]
    fn an_amount_trail_works_the_same_way() {
        let mut stop = sample_stop(Trail::Amount(5.0), 50.0);
        assert!(!advance(&mut stop, 46.0));
        assert!(advance(&mut stop, 45.0));
    }

    #[test]
    fn the_watcher_runs_only_while_a_stop_is_active() {
        assert!(!should_watch(&[]));
        let mut stops = vec![
            sample_stop(Trail::Percent(5.0), 10.0),
            sample_stop(Trail::Percent(5.0), 10.0),
        ];
        assert!(should_watch(&stops));
        stops[0].status = Status::Selling;
        assert!(should_watch(&stops));
        stops[1].status = Status::Sold;
        assert!(!should_watch(&stops));
        stops[0].status = Status::Attention;
        assert!(!should_watch(&stops));
    }
}
