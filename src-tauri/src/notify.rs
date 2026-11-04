//! Desktop notifications for events the app notices while it runs (for example a fired price alert).
//!
//! The webview cannot use the notification plugin itself: only this command is reachable, and it
//! only shows a title and a short text.

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

const MAX_TITLE: usize = 80;
pub const NOTICE_EVENT: &str = "app-notice";
#[cfg(windows)]
const APP_NAME: &str = "Scalable Capital Desktop";
const MAX_BODY: usize = 400;

fn clip(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut clipped: String = text.chars().take(max.saturating_sub(1)).collect();
    clipped.push('…');
    clipped
}

/// Windows shows a toast only for an app ID it knows. The installed app sends its toasts under the
/// bundle identifier, which nothing registers, so they were dropped without an error. Registering
/// the identifier under the current user (display name and icon) makes them appear. Failing to
/// register is not fatal: the notification is then tried anyway.
#[cfg(windows)]
pub fn register_app_id(app: &AppHandle) {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let id = &app.config().identifier;
    let key = format!("Software\\Classes\\AppUserModelId\\{id}");
    let Ok((entry, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(key) else {
        return;
    };
    let _ = entry.set_value("DisplayName", &APP_NAME);
    if let Ok(exe) = std::env::current_exe() {
        let _ = entry.set_value("IconUri", &exe.display().to_string());
    }
}

#[cfg(not(windows))]
pub fn register_app_id(_app: &AppHandle) {}

/// For tray hints that should not be added to the notification center.
pub fn send(app: &AppHandle, title: &str, body: &str) {
    let _ = show_notification(app.clone(), title.to_owned(), body.to_owned());
}

/// Shows a backend notice on the desktop and mirrors it to the notification center.
pub fn announce(app: &AppHandle, kind: &str, title: &str, body: &str) {
    let title = clip(title, MAX_TITLE);
    let body = clip(body, MAX_BODY);
    let shown = show_notification(app.clone(), title.clone(), body.clone()).is_ok();
    let _ = app.emit(NOTICE_EVENT, notice_payload(kind, &title, &body, shown));
}

fn notice_payload(kind: &str, title: &str, text: &str, shown: bool) -> serde_json::Value {
    serde_json::json!({ "kind": kind, "title": title, "text": text, "shown": shown })
}

#[tauri::command]
pub fn show_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(clip(&title, MAX_TITLE))
        .body(clip(&body, MAX_BODY))
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn short_text_is_kept_and_trimmed() {
        assert_eq!(clip("  Price alert  ", 80), "Price alert");
    }

    #[test]
    fn long_text_is_cut_to_the_limit_with_an_ellipsis() {
        let clipped = clip(&"ä".repeat(500), MAX_BODY);
        assert_eq!(clipped.chars().count(), MAX_BODY);
        assert!(clipped.ends_with('…'));
    }

    #[test]
    fn backend_notice_payload_includes_the_display_result() {
        assert_eq!(
            notice_payload(
                "info",
                "Trailing stop reached",
                "Apple reached its trigger.",
                false
            ),
            json!({
                "kind": "info",
                "title": "Trailing stop reached",
                "text": "Apple reached its trigger.",
                "shown": false
            })
        );
    }
}
