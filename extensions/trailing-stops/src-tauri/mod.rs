//! Trailing stop loss and trailing buy stop, kept and watched in the app.
//!
//! Scalable's MCP has no trailing stop (an order is a market, limit or plain stop order), so the
//! app does it itself. A trailing stop loss remembers the highest price seen since it was set and,
//! when the price falls by the chosen percentage or amount below that high, sells the shares at
//! market. A trailing buy stop is the mirror image: it remembers the lowest price, and when the
//! price rises by the distance above that low, it buys for the chosen amount of money at market.
//!
//! This only works while the app runs (the tray keeps it running with the window closed), is
//! signed in and has Trading switched on. The stops are saved in `trailing_stops.json` in the app
//! config folder (no tokens), but a launch always starts with Trading off, so nothing is sold until
//! the user switches it on again. The sale goes through the same preview and submit tools as an
//! order from the dialog and never accepts a warning on the user's behalf.
//!
//! One submodule per responsibility: `store` (the saved file), `quotes` (prices), `orders` (the
//! sale or purchase), `watcher` (the price checks, which run only while a stop is active) and `commands` (what
//! the webview can call).

pub mod commands;
mod orders;
mod quotes;
mod store;
mod watcher;

use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

/// Sent to the webview whenever the list of stops or the problem line changes.
const CHANGED_EVENT: &str = "trailing-stops-changed";
/// Seconds between two price checks until the app passes the setting, and the bounds of that setting.
const DEFAULT_CHECK_SECONDS: u64 = 30;
const MIN_CHECK_SECONDS: u64 = 15;
const MAX_CHECK_SECONDS: u64 = 600;
const MAX_STOPS: usize = 50;
const MAX_NAME: usize = 80;

/// Which way a stop trades: a stop loss sells when the price falls, a buy stop buys when it rises.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    #[default]
    Sell,
    Buy,
}

impl Side {
    pub fn word(self) -> &'static str {
        match self {
            Side::Sell => "sell",
            Side::Buy => "buy",
        }
    }
}

/// How far the stop sits from the extreme price: below the highest for a sale, above the lowest for a purchase.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Trail {
    Percent(f64),
    Amount(f64),
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Watched while Trading is on.
    Active,
    /// A sale or purchase was started. It is never repeated: a stop in this state when the app starts becomes `Attention`.
    Selling,
    /// The sale or purchase went through.
    Sold,
    /// Not watched any more: the user has to look at it (a warning to accept, or an uncertain sale).
    Attention,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrailingStop {
    #[serde(default)]
    pub side: Side,
    pub id: String,
    pub isin: String,
    pub name: String,
    #[serde(default)]
    pub portfolio_id: Option<String>,
    /// The shares to sell; 0 for a buy stop.
    #[serde(default)]
    pub shares: f64,
    /// The money to spend; only for a buy stop.
    #[serde(default)]
    pub amount: Option<f64>,
    pub trail: Trail,
    pub start_price: f64,
    /// The extreme price seen since the stop was set: the highest for a sale, the lowest for a purchase.
    pub high: f64,
    #[serde(default)]
    pub last_price: Option<f64>,
    pub status: Status,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub sold_price: Option<f64>,
    pub created_at: u64,
}

#[derive(Default)]
pub struct TrailingState {
    stops: Mutex<Vec<TrailingStop>>,
    problem: Mutex<Option<String>>,
    /// Seconds between price checks; 0 until the app has passed its setting.
    check_seconds: AtomicU64,
    /// When the last price check finished, in milliseconds since the epoch; 0 before the first.
    last_check_ms: AtomicU64,
    /// Wakes the watcher when it may have work again. It holds one wake-up, so none is lost.
    wake: Notify,
}

impl TrailingState {
    fn check_seconds(&self) -> u64 {
        match self.check_seconds.load(Ordering::Relaxed) {
            0 => DEFAULT_CHECK_SECONDS,
            seconds => seconds,
        }
    }

    fn stamp_check(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64);
        self.last_check_ms.store(now, Ordering::Relaxed);
    }

    fn last_checked(&self) -> Option<u64> {
        match self.last_check_ms.load(Ordering::Relaxed) {
            0 => None,
            ms => Some(ms),
        }
    }

    fn mutate<R>(&self, change: impl FnOnce(&mut Vec<TrailingStop>) -> R) -> R {
        let mut stops = self.stops.lock().unwrap_or_else(|error| error.into_inner());
        change(&mut stops)
    }

    fn snapshot(&self) -> Vec<TrailingStop> {
        self.mutate(|stops| stops.clone())
    }

    /// Whether the price checks have anything to do.
    fn watching(&self) -> bool {
        self.mutate(|stops| watcher::should_watch(stops))
    }

    /// Says whether the problem line changed.
    fn set_problem(&self, problem: Option<String>) -> bool {
        let mut current = self
            .problem
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let changed = *current != problem;
        *current = problem;
        changed
    }

    fn problem(&self) -> Option<String> {
        self.problem
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    fn persist(&self, app: &AppHandle) -> Result<(), String> {
        // Held while writing, so two saves cannot reach the file out of order.
        self.mutate(|stops| store::save(app, stops))
    }

    /// Starts the watcher if it is idle, because a stop may now be active.
    fn wake(&self) {
        self.wake.notify_one();
    }
}

/// Tells the webview the stops changed, so it re-reads them instead of polling.
fn announce_change(app: &AppHandle) {
    let _ = app.emit(CHANGED_EVENT, ());
}

/// Registers the state, loads the saved stops and starts the watcher, which idles unless one of them is active.
pub fn setup(app: &AppHandle) {
    app.manage(TrailingState::default());
    store::load(app);
    watcher::spawn(app);
}

pub fn handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        commands::list_trailing_stops,
        commands::check_trailing_stops_now,
        commands::add_trailing_stop,
        commands::update_trailing_stop,
        commands::remove_trailing_stop,
        commands::set_trailing_interval,
    ]
}

pub fn handles(command: &str) -> bool {
    matches!(
        command,
        "list_trailing_stops"
            | "check_trailing_stops_now"
            | "add_trailing_stop"
            | "update_trailing_stop"
            | "remove_trailing_stop"
            | "set_trailing_interval"
    )
}

/// Whether a trailing-stop sale has started and should get a short chance to finish before Quit.
pub fn busy(app: &AppHandle) -> bool {
    app.state::<TrailingState>()
        .mutate(|stops| has_sale_in_progress(stops))
}

fn has_sale_in_progress(stops: &[TrailingStop]) -> bool {
    stops.iter().any(|stop| stop.status == Status::Selling)
}

#[cfg(test)]
pub(super) fn sample_stop(trail: Trail, high: f64) -> TrailingStop {
    TrailingStop {
        side: Side::Sell,
        id: "a".to_owned(),
        isin: "US0378331005".to_owned(),
        name: "Apple".to_owned(),
        portfolio_id: None,
        shares: 2.0,
        amount: None,
        trail,
        start_price: high,
        high,
        last_price: None,
        status: Status::Active,
        message: None,
        sold_price: None,
        created_at: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_trail_has_a_simple_json_shape_for_the_page() {
        assert_eq!(
            serde_json::to_value(Trail::Percent(5.0)).unwrap(),
            json!({ "kind": "percent", "value": 5.0 })
        );
        let trail: Trail = serde_json::from_value(json!({ "kind": "amount", "value": 2 })).unwrap();
        assert_eq!(trail, Trail::Amount(2.0));
    }

    #[test]
    fn the_problem_line_says_whether_it_changed() {
        let state = TrailingState::default();
        assert!(!state.set_problem(None));
        assert!(state.set_problem(Some("x".to_owned())));
        assert!(!state.set_problem(Some("x".to_owned())));
        assert!(state.set_problem(None));
    }

    #[test]
    fn only_a_selling_stop_counts_as_a_sale_in_progress() {
        let mut stop = sample_stop(Trail::Percent(5.0), 100.0);
        assert!(!has_sale_in_progress(&[]));
        assert!(!has_sale_in_progress(std::slice::from_ref(&stop)));
        stop.status = Status::Selling;
        assert!(has_sale_in_progress(&[stop]));
    }
}
