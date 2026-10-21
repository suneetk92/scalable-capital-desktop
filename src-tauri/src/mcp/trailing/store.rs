//! The saved stops: `trailing_stops.json` in the app config folder.

use super::{Status, TrailingState, TrailingStop};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::files;

const FILE: &str = "trailing_stops.json";

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

pub(super) fn save(app: &AppHandle, stops: &[TrailingStop]) -> Result<(), String> {
    let path = path(app).ok_or("The app config folder is not available.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|error| format!("Could not save the trailing stops: {error}"))?;
    }
    let text = serde_json::to_string(stops).map_err(|error| error.to_string())?;
    files::write_atomically(&path, &text)
        .map_err(|error| format!("Could not save the trailing stops: {error}"))
}

fn parse_stops(text: &str) -> Option<Vec<TrailingStop>> {
    serde_json::from_str(text).ok()
}

/// A sale that was started and never recorded as finished is not repeated: the user checks it.
fn mark_interrupted(stops: &mut [TrailingStop]) {
    for stop in stops
        .iter_mut()
        .filter(|stop| stop.status == Status::Selling)
    {
        stop.status = Status::Attention;
        stop.message = Some(
            "The app stopped while this was being sold. Check your transactions in Scalable before doing anything else.".to_owned(),
        );
    }
}

/// Loads the saved stops into the state.
pub(super) fn load(app: &AppHandle) {
    let state = app.state::<TrailingState>();
    let Some(path) = path(app) else {
        return;
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    match parse_stops(&text) {
        Some(mut stops) => {
            mark_interrupted(&mut stops);
            state.mutate(|current| *current = stops);
        }
        None => {
            // Kept aside, so the next save does not overwrite what could not be read.
            let _ = std::fs::rename(&path, path.with_extension("json.bad"));
            state.set_problem(Some(format!(
                "The saved trailing stops could not be read. The file was kept as {FILE}.bad."
            )));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::trailing::{sample_stop, Trail};

    #[test]
    fn a_sale_that_was_started_is_not_repeated_after_a_restart() {
        let mut stops = vec![
            sample_stop(Trail::Percent(5.0), 10.0),
            sample_stop(Trail::Percent(5.0), 10.0),
        ];
        stops[0].status = Status::Selling;
        mark_interrupted(&mut stops);
        assert_eq!(stops[0].status, Status::Attention);
        assert!(stops[0].message.is_some());
        assert_eq!(stops[1].status, Status::Active);
    }

    #[test]
    fn stops_survive_a_round_trip_and_garbage_is_refused() {
        let stops = vec![sample_stop(Trail::Percent(7.5), 12.0)];
        let text = serde_json::to_string(&stops).unwrap();
        assert_eq!(parse_stops(&text), Some(stops));
        assert_eq!(parse_stops("not json"), None);
    }
}
