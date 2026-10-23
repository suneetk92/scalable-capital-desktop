//! A sanitised diagnostics bundle for bug reports, and a button to open the log folder.
//!
//! The report holds only what is safe to paste into an issue: the app version, the OS, the update
//! channel, whether Trading is on, whether the app is signed in, the background options, the
//! recent redacted log lines and a count of the failure categories in them. It never reads tokens,
//! account data, tool results or settings stored in the webview, and the home folder shows as `~`.

use std::collections::BTreeMap;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{auth, background, logging, mcp};

const RECENT_LINES: usize = 80;

/// The build's name; an extension names its own variant.
#[cfg(not(feature = "extension"))]
const APP_NAME: &str = "Scalable Capital Desktop";
#[cfg(feature = "extension")]
const APP_NAME: &str = crate::extensions::APP_NAME;

/// Anything but "rc" is the stable channel, like `UpdateChannel::parse` in `updates.rs`.
fn channel_label(value: Option<&str>) -> &'static str {
    match value {
        Some("rc") => "rc",
        _ => "stable",
    }
}

/// How often each warning or error message appears in the log lines. The messages hold only a
/// label and an error category (see `logging::log_failure`).
fn failure_counts(lines: &[String]) -> BTreeMap<String, u64> {
    let mut counts = BTreeMap::new();
    for line in lines {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if !matches!(entry["level"].as_str(), Some("WARN" | "ERROR")) {
            continue;
        }
        let target = entry["target"].as_str().unwrap_or("app");
        let message = entry["message"].as_str().unwrap_or("");
        let label = logging::redact(&format!("{target}: {message}"));
        *counts.entry(label).or_insert(0) += 1;
    }
    counts
}

fn build_report(
    version: &str,
    channel: &str,
    trading_on: bool,
    signed_in: bool,
    background: Value,
    log_folder: Option<String>,
    lines: &[String],
) -> String {
    let report = json!({
        "app": {"name": APP_NAME, "version": version},
        "system": {"os": std::env::consts::OS, "arch": std::env::consts::ARCH},
        "settings": {
            "updateChannel": channel,
            "trading": if trading_on { "enabled" } else { "read-only" },
            "signedIn": signed_in,
            "background": background,
        },
        "logFolder": log_folder,
        "failureCounts": failure_counts(lines),
        "recentLog": lines.iter().map(|line| logging::redact(line)).collect::<Vec<_>>(),
    });
    serde_json::to_string_pretty(&report).unwrap_or_default()
}

#[tauri::command]
pub async fn export_diagnostics(
    app: AppHandle,
    update_channel: Option<String>,
) -> Result<String, String> {
    let signed_in = auth::is_signed_in().await;
    let background =
        serde_json::to_value(background::get_background(app.clone())).unwrap_or_default();
    let log_folder = logging::log_dir().map(|dir| logging::redact(&dir.display().to_string()));
    Ok(build_report(
        env!("CARGO_PKG_VERSION"),
        channel_label(update_channel.as_deref()),
        mcp::session::trading_enabled(&app),
        signed_in,
        background,
        log_folder,
        &logging::recent_lines(RECENT_LINES),
    ))
}

/// Opens the fixed log folder in the system file manager; the webview cannot pass a path.
#[tauri::command]
pub fn open_log_folder() -> Result<(), String> {
    let dir = logging::log_dir().ok_or("Logging is not available.")?;
    tauri_plugin_opener::open_path(dir, None::<&str>)
        .map_err(|_| "The log folder could not be opened.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(level: &str, target: &str, message: &str) -> String {
        json!({"ts": "2026-10-20T10:00:00Z", "level": level, "target": target, "message": message})
            .to_string()
    }

    #[test]
    fn only_the_known_channel_values_are_reported() {
        assert_eq!(channel_label(Some("rc")), "rc");
        assert_eq!(channel_label(Some("stable")), "stable");
        assert_eq!(channel_label(Some("https://x?token=abc")), "stable");
        assert_eq!(channel_label(None), "stable");
    }

    #[test]
    fn counts_warnings_and_errors_but_not_info() {
        let lines = vec![
            line("INFO", "app", "started"),
            line("WARN", "mcp", "tool call failed: network"),
            line("WARN", "mcp", "tool call failed: network"),
            line("ERROR", "panic", "boom"),
            "not json".to_owned(),
        ];
        let counts = failure_counts(&lines);
        assert_eq!(counts.len(), 2);
        assert_eq!(counts["mcp: tool call failed: network"], 2);
        assert_eq!(counts["panic: boom"], 1);
    }

    #[test]
    fn the_report_has_the_safe_fields_and_redacts_the_log() {
        let lines = vec![line(
            "WARN",
            "auth",
            "failed with access_token=abc123secret",
        )];
        let text = build_report(
            "1.2.3",
            "rc",
            false,
            true,
            json!({"closeToTray": true}),
            Some("~/logs".to_owned()),
            &lines,
        );
        let report: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(report["app"]["version"], "1.2.3");
        assert_eq!(report["settings"]["trading"], "read-only");
        assert_eq!(report["settings"]["signedIn"], true);
        assert_eq!(report["settings"]["updateChannel"], "rc");
        assert_eq!(report["logFolder"], "~/logs");
        assert!(!text.contains("abc123secret"), "{text}");
        assert!(report["recentLog"][0]
            .as_str()
            .unwrap()
            .contains("[redacted]"));
    }

    #[test]
    fn trading_shows_only_enabled_or_read_only() {
        let on = build_report("1", "stable", true, false, json!({}), None, &[]);
        let report: Value = serde_json::from_str(&on).unwrap();
        assert_eq!(report["settings"]["trading"], "enabled");
        assert_eq!(report["settings"]["signedIn"], false);
    }

    #[test]
    fn the_report_names_the_build_variant() {
        let report: Value = serde_json::from_str(&build_report(
            "1",
            "stable",
            false,
            false,
            json!({}),
            None,
            &[],
        ))
        .unwrap();
        assert_eq!(report["app"]["name"], APP_NAME);
        assert!(APP_NAME.starts_with("Scalable Capital Desktop"));
        #[cfg(not(feature = "extension"))]
        assert_eq!(APP_NAME, "Scalable Capital Desktop");
    }
}
