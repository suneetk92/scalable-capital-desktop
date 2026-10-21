//! Desktop notifications for events the app notices while it runs (for example a fired price alert).
//!
//! The webview cannot use the notification plugin itself: only this command is reachable, and it
//! only shows a title and a short text.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

const MAX_TITLE: usize = 80;
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

/// For events the backend notices itself (a trailing stop), where nobody can fall back to a toast.
pub fn send(app: &AppHandle, title: &str, body: &str) {
    let _ = show_notification(app.clone(), title.to_owned(), body.to_owned());
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
}
