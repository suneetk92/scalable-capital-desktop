//! Links that an embedded widget tries to open in a new window (a logo, a "key facts" link, ...).
//! The webview never opens them: the page is asked first, and only then opens the link in the default browser.

use tauri::{webview::NewWindowResponse, Emitter, WebviewWindowBuilder};
use url::Url;

const MAIN_WINDOW: &str = "main";
const EVENT: &str = "external-link-request";

/// Only plain https links are handed to the page; anything else a widget asks for is dropped.
fn requested(url: &Url) -> Option<String> {
    (url.scheme() == "https" && url.host_str().is_some()).then(|| url.to_string())
}

/// Builds the main window from its entry in `tauri.conf.json` (`create` is off there) so it can have a new-window handler.
pub fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
    else {
        return Ok(());
    };
    let handle = app.handle().clone();
    WebviewWindowBuilder::from_config(app, config)?
        .on_new_window(move |url, _features| {
            if let Some(url) = requested(&url) {
                let _ = handle.emit_to(MAIN_WINDOW, EVENT, url);
            }
            NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_links_are_forwarded() {
        let url = |text: &str| Url::parse(text).unwrap();
        assert_eq!(
            requested(&url("https://www.example.com/symbols/ABC/")),
            Some("https://www.example.com/symbols/ABC/".to_string())
        );
        assert_eq!(requested(&url("http://www.example.com/")), None);
        assert_eq!(requested(&url("file:///etc/passwd")), None);
        assert_eq!(requested(&url("javascript:alert(1)")), None);
        assert_eq!(requested(&url("about:blank")), None);
    }
}
