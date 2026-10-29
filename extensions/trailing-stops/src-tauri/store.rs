//! The saved stops: `trailing_stops.json` in the app config folder.

use super::{announce_change, Status, TrailingState, TrailingStop};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

use crate::files;

const FILE: &str = "trailing_stops.json";
const UNREADABLE: &str = "The saved trailing stops could not be read, so nothing is changed until they can be. Try again in a moment.";

/// Set while the file is there but cannot be read (locked, no permission): nothing is saved over it
/// until a read works.
static LOCKED_OUT: AtomicBool = AtomicBool::new(false);

/// What is on disk.
#[derive(Debug, PartialEq)]
enum Saved {
    Missing,
    /// There, but not readable right now; it is left as it is.
    Unreadable,
    Text(String),
}

/// The notice shown while the file cannot be read; the price checks do not clear it.
pub(super) fn notice() -> Option<String> {
    LOCKED_OUT
        .load(Ordering::SeqCst)
        .then(|| UNREADABLE.to_owned())
}

fn read_saved(path: &Path) -> Saved {
    match std::fs::read_to_string(path) {
        Ok(text) => Saved::Text(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Saved::Missing,
        Err(_) => Saved::Unreadable,
    }
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

pub(super) fn save(app: &AppHandle, stops: &[TrailingStop]) -> Result<(), String> {
    if LOCKED_OUT.load(Ordering::SeqCst) {
        // Read again once the caller lets go of the stops (`persist` saves while holding them).
        let app = app.clone();
        tauri::async_runtime::spawn(async move { load(&app) });
        return Err(UNREADABLE.to_owned());
    }
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

/// Loads the saved stops into the state. A file that cannot be read now is left alone, and saving
/// is refused (and the read tried again) until it can be.
pub(super) fn load(app: &AppHandle) {
    let state = app.state::<TrailingState>();
    let Some(path) = path(app) else {
        return;
    };
    let text = match read_saved(&path) {
        Saved::Text(text) => text,
        Saved::Missing => {
            LOCKED_OUT.store(false, Ordering::SeqCst);
            return;
        }
        Saved::Unreadable => {
            LOCKED_OUT.store(true, Ordering::SeqCst);
            announce_change(app);
            return;
        }
    };
    let retried = LOCKED_OUT.swap(false, Ordering::SeqCst);
    match parse_stops(&text) {
        Some(mut stops) => {
            mark_interrupted(&mut stops);
            // Nothing can have been added while the file was unreadable, but keep it if it was.
            state.mutate(|current| {
                let added: Vec<TrailingStop> = current
                    .drain(..)
                    .filter(|stop| !stops.iter().any(|saved| saved.id == stop.id))
                    .collect();
                *current = stops;
                current.extend(added);
            });
            if retried {
                state.wake();
                announce_change(app);
            }
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
    use crate::ext_trailing_stops::{sample_stop, Trail};

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
    fn a_file_that_cannot_be_read_now_is_not_taken_for_a_missing_one() {
        let directory = std::env::temp_dir().join(format!(
            "scalable-capital-desktop-trailing-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(FILE);
        assert_eq!(read_saved(&path), Saved::Missing);
        std::fs::write(&path, "[]").unwrap();
        assert_eq!(read_saved(&path), Saved::Text("[]".to_owned()));
        std::fs::remove_file(&path).unwrap();
        // A folder in place of the file cannot be read as text, like a locked file.
        std::fs::create_dir_all(&path).unwrap();
        assert_eq!(read_saved(&path), Saved::Unreadable);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn stops_survive_a_round_trip_and_garbage_is_refused() {
        let stops = vec![sample_stop(Trail::Percent(7.5), 12.0)];
        let text = serde_json::to_string(&stops).unwrap();
        assert_eq!(parse_stops(&text), Some(stops));
        assert_eq!(parse_stops("not json"), None);
    }
}
