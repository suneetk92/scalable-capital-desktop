//! Running in the background: the tray icon, closing to the tray and starting with Windows.
//!
//! The options live here, not in the webview's settings, because they are needed before the webview
//! has loaded (whether the first window is shown, what the close button does). They are kept in
//! `background.json` in the app config directory. Start on boot is registered with the OS through
//! the autostart plugin, which the webview cannot call itself (`capabilities/default.json` grants
//! no permission for it): only `get_background` and `set_background` are reachable.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, Window, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

use crate::{files, logging, notify};

const FILE: &str = "background.json";
/// Saved in the file as `version`. Raise it and add a step to `migrate_prefs` when a saved field
/// changes meaning; files without it (the first releases) count as version 0.
const PREFS_VERSION: u64 = 1;
const MAIN_WINDOW: &str = "main";
const MENU_SHOW: &str = "show";
const MENU_QUIT: &str = "quit";
const SALE_QUIT_WAIT: Duration = Duration::from_secs(20);
const SALE_QUIT_POLL: Duration = Duration::from_millis(200);

/// Passed to the app when the OS starts it at login, so it can tell that launch from a manual one.
pub const AUTOSTART_FLAG: &str = "--autostart";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// The close button hides the window to the tray and the app keeps running.
    close_to_tray: bool,
    /// A launch at login starts hidden in the tray instead of opening the window.
    start_minimized: bool,
    /// Whether the user has already been told that closing the window keeps the app running.
    #[serde(default)]
    tray_hint_shown: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            start_minimized: true,
            tray_hint_shown: false,
        }
    }
}

#[derive(Default)]
pub struct BackgroundState(Mutex<Prefs>);

impl BackgroundState {
    fn get(&self) -> Prefs {
        *self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn set(&self, prefs: Prefs) {
        *self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = prefs;
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(flatten)]
    prefs: Prefs,
    launch_at_startup: bool,
}

fn prefs_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

/// One step per saved version, from that version to the next; each step only renames or converts
/// fields, and `Prefs`' defaults still fill in anything missing. So far only version 0 (the
/// unversioned first releases) exists, and it has the fields of version 1.
fn migrate_prefs(_version: u64, value: serde_json::Value) -> serde_json::Value {
    value
}

/// Anything unreadable gives the defaults, so a damaged file never blocks the window. A file from
/// a newer app is read for the fields this version knows.
fn parse_prefs(text: &str) -> Result<Prefs, serde_json::Error> {
    let mut value: serde_json::Value = serde_json::from_str(text)?;
    let mut version = value.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
    while version < PREFS_VERSION {
        value = migrate_prefs(version, value);
        version += 1;
    }
    serde_json::from_value(value)
}

fn serialize_prefs(prefs: &Prefs) -> Result<String, serde_json::Error> {
    let mut value = serde_json::to_value(prefs)?;
    if let Some(object) = value.as_object_mut() {
        object.insert("version".to_owned(), serde_json::json!(PREFS_VERSION));
    }
    serde_json::to_string(&value)
}

fn keep_bad_prefs(path: &Path) {
    let backup = path.with_extension("bad");
    let backup = if backup.exists() {
        (1..=100)
            .map(|suffix| path.with_file_name(format!("{FILE}.bad.{suffix}")))
            .find(|candidate| !candidate.exists())
    } else {
        Some(backup)
    };
    if let Some(backup) = backup {
        let _ = std::fs::rename(path, backup);
    }
}

fn read_prefs(path: &Path) -> Prefs {
    match std::fs::read_to_string(path) {
        Ok(text) => match parse_prefs(&text) {
            Ok(prefs) => prefs,
            Err(_) => {
                keep_bad_prefs(path);
                Prefs::default()
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Prefs::default(),
        Err(_) => {
            keep_bad_prefs(path);
            Prefs::default()
        }
    }
}

fn load_prefs(app: &AppHandle) -> Prefs {
    prefs_path(app).map_or_else(Prefs::default, |path| read_prefs(&path))
}

fn save_prefs(app: &AppHandle, prefs: Prefs) -> Result<(), String> {
    let path = prefs_path(app).ok_or("The app config folder is not available.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Could not save the settings: {e}"))?;
    }
    let text = serialize_prefs(&prefs).map_err(|e| e.to_string())?;
    files::write_atomically(&path, &text).map_err(|e| format!("Could not save the settings: {e}"))
}

/// Whether the first window stays hidden: only for a launch at login with "start minimized" on.
fn starts_hidden<I: IntoIterator<Item = String>>(args: I, prefs: Prefs) -> bool {
    prefs.start_minimized && args.into_iter().any(|arg| arg == AUTOSTART_FLAG)
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Called from the builder: the close button hides the main window when "close to tray" is on.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != MAIN_WINDOW {
            return;
        }
        let state = window.state::<BackgroundState>();
        let mut prefs = state.get();
        if prefs.close_to_tray {
            api.prevent_close();
            let _ = window.hide();
            if !prefs.tray_hint_shown {
                notify::send(
                    window.app_handle(),
                    "Scalable Capital Desktop is still running",
                    "The app is still running in the tray. Choose Quit from the tray menu to exit.",
                );
                prefs.tray_hint_shown = true;
                state.set(prefs);
                let _ = save_prefs(window.app_handle(), prefs);
            }
        }
    }
}

/// Called when a second copy is started: shows the window of the running one instead.
pub fn on_second_instance(app: &AppHandle) {
    show_main(app);
}

/// Loads the options, builds the tray icon and shows the main window (hidden at a minimized login start).
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let prefs = load_prefs(app);
    app.state::<BackgroundState>().set(prefs);

    let show = MenuItem::with_id(
        app,
        MENU_SHOW,
        "Open Scalable Capital Desktop",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Scalable Capital Desktop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_SHOW => show_main(app),
            MENU_QUIT => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let deadline = tokio::time::Instant::now() + SALE_QUIT_WAIT;
                    while crate::extensions::busy(&app) && tokio::time::Instant::now() < deadline {
                        tokio::time::sleep(SALE_QUIT_POLL).await;
                    }
                    app.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    if !starts_hidden(std::env::args(), prefs) {
        show_main(app);
    }
    Ok(())
}

fn status(app: &AppHandle) -> Status {
    Status {
        prefs: app.state::<BackgroundState>().get(),
        launch_at_startup: app.autolaunch().is_enabled().unwrap_or(false),
    }
}

#[tauri::command]
pub fn get_background(app: AppHandle) -> Status {
    status(&app)
}

#[tauri::command]
pub fn set_background(
    app: AppHandle,
    state: State<'_, BackgroundState>,
    close_to_tray: bool,
    start_minimized: bool,
    launch_at_startup: bool,
) -> Result<Status, String> {
    let prefs = Prefs {
        close_to_tray,
        start_minimized,
        tray_hint_shown: state.get().tray_hint_shown,
    };
    let autolaunch = app.autolaunch();
    let registered = autolaunch.is_enabled().unwrap_or(false);
    if launch_at_startup && !registered {
        autolaunch
            .enable()
            .map_err(|e| format!("Could not turn on start with Windows: {e}"))
            .inspect_err(|_| logging::log_failure("background", "turning on autostart", ""))?;
    } else if !launch_at_startup && registered {
        autolaunch
            .disable()
            .map_err(|e| format!("Could not turn off start with Windows: {e}"))
            .inspect_err(|_| logging::log_failure("background", "turning off autostart", ""))?;
    }
    save_prefs(&app, prefs).inspect_err(|error| {
        logging::log_failure("background", "saving the background options", error)
    })?;
    state.set(prefs);
    Ok(status(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn defaults_close_to_tray_and_start_minimized() {
        assert_eq!(
            Prefs::default(),
            Prefs {
                close_to_tray: true,
                start_minimized: true,
                tray_hint_shown: false,
            }
        );
    }

    #[test]
    fn parses_stored_options_and_fills_missing_ones() {
        let prefs = parse_prefs(r#"{"closeToTray":false}"#).unwrap();
        assert!(!prefs.close_to_tray);
        assert!(prefs.start_minimized);
        assert!(!prefs.tray_hint_shown);
    }

    #[test]
    fn the_file_carries_a_schema_version_and_older_or_newer_files_still_load() {
        let saved = serialize_prefs(&Prefs {
            close_to_tray: false,
            ..Prefs::default()
        })
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&saved).unwrap();
        assert_eq!(value["version"], serde_json::json!(PREFS_VERSION));
        assert!(!parse_prefs(&saved).unwrap().close_to_tray);
        // Unversioned (version 0) and newer files are read for the fields this version knows.
        assert!(
            !parse_prefs(r#"{"closeToTray":false}"#)
                .unwrap()
                .close_to_tray
        );
        let newer = format!(
            r#"{{"version":{},"closeToTray":false,"futureOption":1}}"#,
            PREFS_VERSION + 5
        );
        assert!(!parse_prefs(&newer).unwrap().close_to_tray);
        assert!(parse_prefs(r#"{"version":"x"}"#).is_ok());
        assert!(parse_prefs("[1]").is_err());
    }

    #[test]
    fn damaged_file_gives_the_defaults() {
        let directory = std::env::temp_dir().join(format!(
            "scalable-capital-desktop-background-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(FILE);
        std::fs::write(&path, "not json").unwrap();

        assert_eq!(read_prefs(&path), Prefs::default());
        assert!(!path.exists());
        assert_eq!(
            std::fs::read_to_string(directory.join("background.bad")).unwrap(),
            "not json"
        );
        assert_eq!(read_prefs(&path), Prefs::default());

        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn only_a_login_launch_can_start_hidden() {
        let on = Prefs::default();
        assert!(starts_hidden(args(&["app", AUTOSTART_FLAG]), on));
        assert!(!starts_hidden(args(&["app"]), on));
        let off = Prefs {
            start_minimized: false,
            ..on
        };
        assert!(!starts_hidden(args(&["app", AUTOSTART_FLAG]), off));
    }
}
