//! The price checks. They run only while at least one stop is active: with none, the watcher
//! waits for a wake-up (a stop was added, or the saved stops were loaded) and does not tick.

use super::{
    announce_change,
    orders::execute,
    quotes::{quote_prices, Quote},
    Side, Status, Trail, TrailingState, TrailingStop,
};
use crate::mcp::trading::TradingGate;
use crate::notify;
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

/// The securities with an active stop that got no price for its side.
fn missing_prices<'a>(stops: &[TrailingStop], prices: &'a [(String, Quote)]) -> Vec<&'a str> {
    prices
        .iter()
        .filter(|(isin, quote)| {
            stops.iter().any(|stop| {
                stop.status == Status::Active
                    && stop.isin == *isin
                    && quote.for_side(stop.side).is_none()
            })
        })
        .map(|(isin, _)| isin.as_str())
        .collect()
}

/// After a failed save, only the stops this pass hit are held back; a sale another pass started is left to finish.
fn hold_unsaved(stops: &mut [TrailingStop], hits: &[TrailingStop], error: &str) {
    for stop in stops
        .iter_mut()
        .filter(|stop| stop.status == Status::Selling && hits.iter().any(|hit| hit.id == stop.id))
    {
        stop.status = Status::Attention;
        stop.message = Some(format!(
            "Nothing was sent, because the stop could not be saved: {error}"
        ));
    }
}

/// Sets the problem line and tells the webview when it changed.
fn report(app: &AppHandle, state: &TrailingState, problem: Option<String>) {
    if state.set_problem(problem) {
        announce_change(app);
    }
}

/// What one pass found: the stops to trade now, the ones whose trigger was reached while they
/// could not trade (to tell the user), and whether anything is to be saved.
#[derive(Debug, Default)]
struct Step {
    hits: Vec<TrailingStop>,
    reached: Vec<TrailingStop>,
    changed: bool,
}

/// Moves every active stop with its price, at any access level, so its trigger stays current. With
/// `trading` (Full access, exchange open) a hit stop is marked as selling; without it the stop stays
/// active and is reported once per crossing, until the price moves back past the trigger.
fn step(stops: &mut [TrailingStop], prices: &[(String, Quote)], trading: bool) -> Step {
    let mut found = Step::default();
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
        let reached = stop.trigger_reached;
        if !advance(stop, price) {
            stop.trigger_reached = false;
        } else if trading {
            stop.status = Status::Selling;
            stop.trigger_reached = false;
            found.hits.push(stop.clone());
            found.changed = true;
        } else if !stop.trigger_reached {
            stop.trigger_reached = true;
            found.reached.push(stop.clone());
        }
        found.changed |=
            stop.high != high || stop.last_price != last || stop.trigger_reached != reached;
    }
    found
}

/// Tells the user that a stop's trigger was reached but no order can be placed yet.
fn notify_reached(app: &AppHandle, stop: &TrailingStop) {
    let price = stop.last_price.unwrap_or_default();
    let trigger = trigger_price(stop.side, stop.high, stop.trail);
    let (title, kind) = match stop.side {
        Side::Sell => ("Trailing stop reached", "Trailing stop"),
        Side::Buy => ("Trailing buy stop reached", "Trailing buy stop"),
    };
    notify::send(
        app,
        title,
        &format!(
            "{kind} for {}: the price {price:.2} EUR reached the trigger {trigger:.2} EUR. Switch to Full access while the exchange is open to {}.",
            stop.name,
            stop.side.word()
        ),
    );
}

/// One pass: reads the prices of the active stops, moves their highs up (or lows down) and trades the ones that were hit
/// (with Full access while the exchange is open) or tells the user about them (without).
pub(super) async fn check(app: &AppHandle) {
    run_check(app).await;
    app.state::<TrailingState>().stamp_check();
    super::announce_change(app);
}

async fn run_check(app: &AppHandle) {
    let gate = app.state::<TradingGate>();
    let state = app.state::<TrailingState>();
    let watched = state.snapshot();
    let mut targets: Vec<(String, Option<String>)> = Vec::new();
    for stop in watched.iter().filter(|stop| stop.status == Status::Active) {
        if !targets.iter().any(|(isin, _)| *isin == stop.isin) {
            targets.push((stop.isin.clone(), stop.portfolio_id.clone()));
        }
    }
    if targets.is_empty() {
        report(app, &state, None);
        return;
    }
    let prices = match quote_prices(app, targets).await {
        Ok(prices) => prices,
        Err(error) => {
            report(app, &state, Some(format!("Could not read prices: {error}")));
            return;
        }
    };
    let missing = missing_prices(&watched, &prices);
    report(
        app,
        &state,
        (!missing.is_empty())
            .then(|| format!("No price from Scalable for {}.", missing.join(", "))),
    );
    // Read after the prices, so Trading switched off while they loaded places nothing.
    let trading = gate.is_on();
    let Step {
        hits,
        reached,
        changed,
    } = state.mutate(|stops| step(stops, &prices, trading));
    if changed {
        // A stop must be saved as selling before anything is sent, so a crash cannot repeat the sale.
        if let Err(error) = state.persist(app) {
            if !hits.is_empty() {
                state.mutate(|stops| hold_unsaved(stops, &hits, &error));
                announce_change(app);
                return;
            }
            state.set_problem(Some(error));
        }
        announce_change(app);
    }
    for stop in &reached {
        notify_reached(app, stop);
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
    use crate::ext_trailing_stops::sample_stop;

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

    fn price(isin: &str, value: f64) -> Vec<(String, Quote)> {
        vec![(
            isin.to_owned(),
            Quote {
                sell: Some(value),
                buy: Some(value),
            },
        )]
    }

    #[test]
    fn the_high_follows_the_price_while_trading_is_off() {
        let mut stops = vec![sample_stop(Trail::Percent(10.0), 100.0)];
        let isin = stops[0].isin.clone();
        let found = step(&mut stops, &price(&isin, 120.0), false);
        assert_eq!(stops[0].high, 120.0);
        assert!(found.changed && found.hits.is_empty() && found.reached.is_empty());
        let mut buy = vec![sample_stop(Trail::Percent(10.0), 100.0)];
        buy[0].side = Side::Buy;
        step(&mut buy, &price(&isin, 80.0), false);
        assert_eq!(buy[0].high, 80.0);
    }

    #[test]
    fn a_reached_trigger_without_full_access_places_nothing_and_is_told_once() {
        let mut stops = vec![sample_stop(Trail::Percent(10.0), 100.0)];
        let isin = stops[0].isin.clone();
        let found = step(&mut stops, &price(&isin, 85.0), false);
        assert!(found.hits.is_empty());
        assert_eq!(found.reached.len(), 1);
        assert_eq!(stops[0].status, Status::Active);
        assert!(stops[0].trigger_reached);
        // Still past the trigger: no second notice.
        let found = step(&mut stops, &price(&isin, 84.0), false);
        assert!(found.reached.is_empty() && found.hits.is_empty());
        // With Full access it trades at the next check.
        let found = step(&mut stops, &price(&isin, 84.0), true);
        assert_eq!(found.hits.len(), 1);
        assert_eq!(stops[0].status, Status::Selling);
        assert!(!stops[0].trigger_reached);
    }

    #[test]
    fn the_notice_comes_again_after_the_price_moved_back_past_the_trigger() {
        let mut stops = vec![sample_stop(Trail::Percent(10.0), 100.0)];
        let isin = stops[0].isin.clone();
        assert_eq!(
            step(&mut stops, &price(&isin, 85.0), false).reached.len(),
            1
        );
        let found = step(&mut stops, &price(&isin, 95.0), false);
        assert!(found.changed && found.reached.is_empty());
        assert!(!stops[0].trigger_reached);
        assert_eq!(
            step(&mut stops, &price(&isin, 85.0), false).reached.len(),
            1
        );
    }

    #[test]
    fn a_failed_save_holds_back_only_the_stops_this_pass_hit() {
        let mut stops = vec![
            sample_stop(Trail::Percent(5.0), 10.0),
            sample_stop(Trail::Percent(5.0), 10.0),
        ];
        stops[1].id = "b".to_owned();
        stops[0].status = Status::Selling;
        stops[1].status = Status::Selling;
        let hits = vec![stops[0].clone()];
        hold_unsaved(&mut stops, &hits, "disk full");
        assert_eq!(stops[0].status, Status::Attention);
        assert!(stops[0].message.as_deref().unwrap().contains("disk full"));
        assert_eq!(stops[1].status, Status::Selling);
        assert_eq!(stops[1].message, None);
    }

    #[test]
    fn a_price_is_missing_when_the_side_of_an_active_stop_has_none() {
        let mut buy = sample_stop(Trail::Percent(5.0), 10.0);
        buy.side = Side::Buy;
        let prices = vec![(
            buy.isin.clone(),
            Quote {
                sell: Some(9.5),
                buy: None,
            },
        )];
        assert_eq!(
            missing_prices(std::slice::from_ref(&buy), &prices),
            vec![buy.isin.as_str()]
        );
        let sell = sample_stop(Trail::Percent(5.0), 10.0);
        assert!(missing_prices(&[sell], &prices).is_empty());
        buy.status = Status::Attention;
        assert!(missing_prices(&[buy], &prices).is_empty());
    }
}
