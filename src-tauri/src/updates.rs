//! Update checks and installs, signed with the Tauri updater key.
//!
//! The webview cannot use the updater or process plugins itself (`capabilities/default.json` grants
//! neither): only these two commands are reachable. `check_for_update` asks the endpoint in
//! `tauri.conf.json` (`plugins.updater`) for a newer version (the release candidate channel asks
//! `latest-rc.json` next to it instead, see `UpdateChannel`) and keeps the answer in managed state,
//! `install_update` downloads it, verifies its minisign signature against the public key from the
//! same file, installs it and restarts the app. The restart starts read-only like every launch, so an
//! install is not held back by the Trading switch.

use std::path::Path;
use std::sync::Mutex;

use semver::Version;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

use crate::logging;

const MAX_NOTES: usize = 2000;
const MAX_ERROR: usize = 200;

/// Which manifest an update check reads: `latest.json` (stable releases only) or `latest-rc.json`
/// (the newest release, release candidates included).
#[derive(Clone, Copy, Debug, PartialEq)]
enum UpdateChannel {
    Stable,
    ReleaseCandidate,
}

impl UpdateChannel {
    /// Anything but "rc" is the stable channel, so a bad value never opts in to pre-releases.
    fn parse(value: Option<&str>) -> Self {
        match value {
            Some("rc") => Self::ReleaseCandidate,
            _ => Self::Stable,
        }
    }

    fn manifest(self) -> &'static str {
        match self {
            Self::Stable => "latest.json",
            Self::ReleaseCandidate => "latest-rc.json",
        }
    }

    fn page(self) -> &'static str {
        match self {
            Self::Stable => "index.html",
            Self::ReleaseCandidate => "index-rc.html",
        }
    }
}

/// A reinstall also accepts the version that is already running, so the user can install it again.
fn accepts_update(
    current: &Version,
    remote: &Version,
    channel: UpdateChannel,
    reinstall: bool,
) -> bool {
    (remote > current || (reinstall && remote == current))
        && (channel == UpdateChannel::ReleaseCandidate || remote.pre.is_empty())
}

/// The update `check_for_update` found, waiting for `install_update`.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    date: Option<String>,
    can_install: bool,
    release_url: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum UpdateProgress {
    Started { total: Option<u64> },
    Chunk { received: u64 },
    Finished,
}

fn clip(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut clipped: String = text.chars().take(max.saturating_sub(1)).collect();
    clipped.push('…');
    clipped
}

fn build_info(
    version: &str,
    current_version: &str,
    notes: Option<&str>,
    date: Option<String>,
    can_install: bool,
    release_url: Option<String>,
) -> UpdateInfo {
    UpdateInfo {
        version: version.to_owned(),
        current_version: current_version.to_owned(),
        notes: notes
            .map(|notes| clip(notes, MAX_NOTES))
            .filter(|notes| !notes.is_empty()),
        date,
        can_install,
        release_url,
    }
}

/// The download page next to `latest.json` (`<base>/latest.json` gives `<base>/index.html`, and
/// `<base>/index-rc.html` for the release candidate channel). The release scripts write it with the
/// links to the current installers.
fn download_page_url(endpoint: &str, channel: UpdateChannel) -> Option<String> {
    let base = endpoint.strip_suffix("/latest.json")?;
    if !base.starts_with("https://") {
        return None;
    }
    Some(format!("{base}/{}", channel.page()))
}

const GITHUB_LATEST_MANIFEST: &str = "/releases/latest/download/latest.json";

/// The GitHub release page for the endpoints that point at a GitHub repository's releases: the latest
/// release for the stable channel, the releases list (which shows pre-releases) for the release
/// candidate channel. Falls back to the download page next to the first endpoint.
fn release_page_url(endpoints: &[String], channel: UpdateChannel) -> Option<String> {
    let github = endpoints.iter().find_map(|endpoint| {
        let repo = endpoint.strip_suffix(GITHUB_LATEST_MANIFEST)?;
        repo.starts_with("https://github.com/").then_some(repo)
    });
    match (github, channel) {
        (Some(repo), UpdateChannel::Stable) => Some(format!("{repo}/releases/latest")),
        (Some(repo), UpdateChannel::ReleaseCandidate) => Some(format!("{repo}/releases")),
        (None, _) => endpoints
            .first()
            .and_then(|endpoint| download_page_url(endpoint, channel)),
    }
}

/// The manifest of a channel, next to the configured `latest.json`.
fn manifest_url(endpoint: &str, channel: UpdateChannel) -> Option<Url> {
    let base = endpoint.strip_suffix("/latest.json")?;
    Url::parse(&format!("{base}/{}", channel.manifest())).ok()
}

/// Whether this install can replace itself. The portable Windows exe, deb and rpm installs and a
/// build that does not run from a bundle cannot: the updater would run an installer or overwrite
/// files the package manager owns.
fn can_self_update(os: &str, exe: &Path, appimage: bool, has_uninstaller: bool) -> bool {
    let exe = exe.to_string_lossy().to_lowercase().replace('\\', "/");
    match os {
        "windows" => has_uninstaller || exe.contains("/program files"),
        "macos" => exe.contains(".app/contents/macos/"),
        "linux" => appimage,
        _ => false,
    }
}

fn running_install_can_update() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let has_uninstaller = exe
        .parent()
        .is_some_and(|dir| dir.join("uninstall.exe").is_file());
    let appimage = std::env::var_os("APPIMAGE").is_some_and(|value| !value.is_empty());
    can_self_update(std::env::consts::OS, &exe, appimage, has_uninstaller)
}

fn endpoints(app: &AppHandle) -> Vec<String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("endpoints"))
        .and_then(|endpoints| endpoints.as_array())
        .map(|endpoints| {
            endpoints
                .iter()
                .filter_map(|endpoint| endpoint.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn failure(error: impl std::fmt::Display) -> String {
    clip(&error.to_string(), MAX_ERROR)
}

#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    channel: Option<String>,
    reinstall: Option<bool>,
) -> Result<Option<UpdateInfo>, String> {
    check(app, pending, channel, reinstall.unwrap_or(false))
        .await
        .inspect_err(|error| logging::log_failure("updates", "update check", error))
}

async fn check(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    channel: Option<String>,
    reinstall: bool,
) -> Result<Option<UpdateInfo>, String> {
    *pending.0.lock().map_err(failure)? = None;
    let channel = UpdateChannel::parse(channel.as_deref());
    let configured = endpoints(&app);
    let mut builder = app.updater_builder();
    builder = builder.version_comparator(move |current, remote| {
        accepts_update(&current, &remote.version, channel, reinstall)
    });
    if channel != UpdateChannel::Stable {
        let url = configured
            .first()
            .and_then(|endpoint| manifest_url(endpoint, channel))
            .ok_or("The update endpoint has no release candidate channel.")?;
        builder = builder.endpoints(vec![url]).map_err(failure)?;
    }
    let updater = builder.build().map_err(failure)?;
    let update = updater.check().await.map_err(failure)?;
    let Some(update) = update else {
        *pending.0.lock().map_err(failure)? = None;
        return Ok(None);
    };
    let release_url = release_page_url(&configured, channel);
    let info = build_info(
        &update.version,
        &update.current_version,
        update.body.as_deref(),
        update.date.map(|date| date.date().to_string()),
        running_install_can_update(),
        release_url,
    );
    *pending.0.lock().map_err(failure)? = Some(update);
    Ok(Some(info))
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    on_progress: Channel<UpdateProgress>,
) -> Result<(), String> {
    if !running_install_can_update() {
        return Err("This install cannot update itself. Download the new version instead.".into());
    }
    let update = pending
        .0
        .lock()
        .map_err(failure)?
        .clone()
        .ok_or("No update is ready. Check for updates first.")?;
    let mut received: u64 = 0;
    let mut started = false;
    let progress = on_progress.clone();
    update
        .download_and_install(
            move |chunk, total| {
                if !started {
                    started = true;
                    let _ = progress.send(UpdateProgress::Started { total });
                }
                received += chunk as u64;
                let _ = progress.send(UpdateProgress::Chunk { received });
            },
            || {
                let _ = on_progress.send(UpdateProgress::Finished);
            },
        )
        .await
        .map_err(failure)
        .inspect_err(|error| logging::log_failure("updates", "update install", error))?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_windows_apps_can_update_but_the_portable_exe_cannot() {
        let nsis = Path::new(
            r"C:\Users\me\AppData\Local\scalable-capital-desktop\scalable-capital-desktop.exe",
        );
        let msi =
            Path::new(r"C:\Program Files\scalable-capital-desktop\scalable-capital-desktop.exe");
        let portable = Path::new(r"C:\Users\me\Downloads\scalable-capital-desktop-portable.exe");
        assert!(can_self_update("windows", nsis, false, true));
        assert!(can_self_update("windows", msi, false, false));
        assert!(!can_self_update("windows", portable, false, false));
    }

    #[test]
    fn linux_updates_only_from_an_appimage() {
        let exe = Path::new("/usr/bin/scalable-capital-desktop");
        assert!(can_self_update("linux", exe, true, false));
        assert!(!can_self_update("linux", exe, false, false));
    }

    #[test]
    fn macos_updates_only_from_an_app_bundle() {
        let bundle = Path::new(
            "/Applications/scalable-capital-desktop.app/Contents/MacOS/scalable-capital-desktop",
        );
        let loose = Path::new("/tmp/scalable-capital-desktop");
        assert!(can_self_update("macos", bundle, false, false));
        assert!(!can_self_update("macos", loose, false, false));
        assert!(!can_self_update("freebsd", bundle, true, true));
    }

    #[test]
    fn notes_are_clipped_and_empty_notes_are_dropped() {
        let info = build_info("1.2.0", "1.1.0", Some(&"x".repeat(5000)), None, true, None);
        assert_eq!(
            info.notes.as_deref().map(|n| n.chars().count()),
            Some(MAX_NOTES)
        );
        assert!(info.notes.unwrap().ends_with('…'));
        assert_eq!(
            build_info("1.2.0", "1.1.0", Some("  "), None, true, None).notes,
            None
        );
    }

    #[test]
    fn update_info_serialises_in_camel_case() {
        let info = build_info(
            "1.2.0",
            "1.1.0",
            Some("Fixes"),
            Some("2026-10-15".into()),
            false,
            Some("https://updates.example.com/app/index.html".into()),
        );
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({
                "version": "1.2.0",
                "currentVersion": "1.1.0",
                "notes": "Fixes",
                "date": "2026-10-15",
                "canInstall": false,
                "releaseUrl": "https://updates.example.com/app/index.html"
            })
        );
    }

    #[test]
    fn progress_events_are_tagged() {
        assert_eq!(
            serde_json::to_value(UpdateProgress::Started { total: Some(10) }).unwrap(),
            serde_json::json!({ "event": "started", "total": 10 })
        );
        assert_eq!(
            serde_json::to_value(UpdateProgress::Chunk { received: 4 }).unwrap(),
            serde_json::json!({ "event": "chunk", "received": 4 })
        );
        assert_eq!(
            serde_json::to_value(UpdateProgress::Finished).unwrap(),
            serde_json::json!({ "event": "finished" })
        );
    }

    #[test]
    fn a_reinstall_accepts_the_running_version_but_never_an_older_one() {
        let current = Version::parse("1.2.0").unwrap();
        let channel = UpdateChannel::Stable;
        assert!(accepts_update(&current, &current, channel, true));
        assert!(!accepts_update(&current, &current, channel, false));
        assert!(!accepts_update(
            &current,
            &Version::parse("1.1.0").unwrap(),
            channel,
            true
        ));
    }

    #[test]
    fn update_comparator_requires_newer_versions_and_keeps_stable_releases_stable() {
        let current = Version::parse("1.2.0").unwrap();
        assert!(accepts_update(
            &current,
            &Version::parse("1.2.1").unwrap(),
            UpdateChannel::Stable,
            false
        ));
        assert!(!accepts_update(
            &current,
            &Version::parse("1.2.0").unwrap(),
            UpdateChannel::Stable,
            false
        ));
        assert!(!accepts_update(
            &current,
            &Version::parse("1.3.0-rc.1").unwrap(),
            UpdateChannel::Stable,
            false
        ));
        assert!(accepts_update(
            &current,
            &Version::parse("1.3.0-rc.1").unwrap(),
            UpdateChannel::ReleaseCandidate,
            false
        ));
        assert!(!accepts_update(
            &Version::parse("1.3.0-rc.1").unwrap(),
            &Version::parse("1.3.0-rc.1").unwrap(),
            UpdateChannel::ReleaseCandidate,
            false
        ));
    }

    #[test]
    fn the_download_page_sits_next_to_latest_json_on_https_only() {
        assert_eq!(
            download_page_url(
                "https://updates.example.com/app/latest.json",
                UpdateChannel::Stable
            )
            .as_deref(),
            Some("https://updates.example.com/app/index.html")
        );
        assert_eq!(
            download_page_url(
                "https://updates.example.com/app/latest.json",
                UpdateChannel::ReleaseCandidate
            )
            .as_deref(),
            Some("https://updates.example.com/app/index-rc.html")
        );
        assert_eq!(
            download_page_url(
                "http://updates.example.com/app/latest.json",
                UpdateChannel::Stable
            ),
            None
        );
        assert_eq!(
            download_page_url(
                "https://updates.example.com/app/manifest.json",
                UpdateChannel::Stable
            ),
            None
        );
    }

    #[test]
    fn the_release_page_is_the_github_release_when_an_endpoint_points_there() {
        let endpoints = [
            "https://updates.example.com/app/latest.json".to_owned(),
            "https://github.com/owner/repo/releases/latest/download/latest.json".to_owned(),
        ];
        assert_eq!(
            release_page_url(&endpoints, UpdateChannel::Stable).as_deref(),
            Some("https://github.com/owner/repo/releases/latest")
        );
        assert_eq!(
            release_page_url(&endpoints, UpdateChannel::ReleaseCandidate).as_deref(),
            Some("https://github.com/owner/repo/releases")
        );
        assert_eq!(
            release_page_url(&endpoints[..1], UpdateChannel::Stable).as_deref(),
            Some("https://updates.example.com/app/index.html")
        );
        assert_eq!(release_page_url(&[], UpdateChannel::Stable), None);
    }

    #[test]
    fn only_rc_selects_the_release_candidate_channel() {
        assert_eq!(
            UpdateChannel::parse(Some("rc")),
            UpdateChannel::ReleaseCandidate
        );
        assert_eq!(UpdateChannel::parse(Some("stable")), UpdateChannel::Stable);
        assert_eq!(UpdateChannel::parse(Some("RC ")), UpdateChannel::Stable);
        assert_eq!(UpdateChannel::parse(None), UpdateChannel::Stable);
    }

    #[test]
    fn the_release_candidate_manifest_sits_next_to_latest_json() {
        assert_eq!(
            manifest_url(
                "https://updates.example.com/app/latest.json",
                UpdateChannel::ReleaseCandidate
            )
            .map(String::from)
            .as_deref(),
            Some("https://updates.example.com/app/latest-rc.json")
        );
        assert_eq!(
            manifest_url(
                "https://updates.example.com/app/other.json",
                UpdateChannel::ReleaseCandidate
            ),
            None
        );
    }
}
