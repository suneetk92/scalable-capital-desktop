//! A small privacy-safe log file with size-based rotation and panic capture.
//!
//! Lines are JSON (`ts`, `level`, `target`, `message`) in `scalable-capital-desktop.log` in the app
//! log directory, rotated at 1 MB over three files (`.log`, `.log.1`, `.log.2`). Every message goes
//! through `redact` first, and call sites log only a short label plus an error category from
//! `error_category`: never arguments, response bodies or raw error text. Nothing is sent anywhere;
//! the file is only read by `diagnostics.rs` when the user copies the diagnostics.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const FILE_NAME: &str = "scalable-capital-desktop.log";
const MAX_BYTES: u64 = 1_000_000;
const FILES: usize = 3;
const MAX_MESSAGE: usize = 300;
const REDACTED: &str = "[redacted]";

/// Keys whose value is removed in `key=value`, `key: value` and `"key":"value"` text.
const SECRET_KEYS: [&str; 11] = [
    "access_token",
    "refresh_token",
    "id_token",
    "client_secret",
    "code_verifier",
    "password",
    "secret",
    "authorization",
    "api_key",
    "apikey",
    "token",
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn label(self) -> &'static str {
        match self {
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
        }
    }
}

struct Logger {
    path: PathBuf,
    max_bytes: u64,
    files: usize,
    write: Mutex<()>,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();

/// Starts logging into `dir` and installs the panic hook. Without a usable directory logging stays
/// off and every call is a no-op.
pub fn init(dir: PathBuf) {
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let logger = Logger {
        path: dir.join(FILE_NAME),
        max_bytes: MAX_BYTES,
        files: FILES,
        write: Mutex::new(()),
    };
    if LOGGER.set(logger).is_ok() {
        install_panic_hook();
    }
}

/// The folder that holds the log files, when logging is on.
pub fn log_dir() -> Option<PathBuf> {
    LOGGER
        .get()
        .and_then(|logger| logger.path.parent().map(Path::to_path_buf))
}

pub fn log_event(level: Level, target: &str, message: &str) {
    let Some(logger) = LOGGER.get() else {
        return;
    };
    let line = format_line(now_secs(), level, target, message);
    let _guard = logger
        .write
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _ = write_line(&logger.path, logger.max_bytes, logger.files, &line);
}

/// Logs that `what` failed with only the category of `error`, never its text.
pub fn log_failure(target: &str, what: &str, error: &str) {
    log_event(
        Level::Warn,
        target,
        &format!("{what} failed: {}", error_category(error)),
    );
}

/// The newest `max` log lines, oldest first.
pub fn recent_lines(max: usize) -> Vec<String> {
    LOGGER
        .get()
        .map(|logger| read_recent(&logger.path, logger.files, max))
        .unwrap_or_default()
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .map(|text| (*text).to_owned())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic without a text message".to_owned());
        let location = info
            .location()
            .map(|place| format!(" at {}:{}", place.file(), place.line()))
            .unwrap_or_default();
        log_event(Level::Error, "panic", &format!("{message}{location}"));
        previous(info);
    }));
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// `1970-01-01T00:00:00Z` style UTC time, without a date crate.
fn utc_timestamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_part + 2) / 5 + 1;
    let month = if month_part < 10 {
        month_part + 3
    } else {
        month_part - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

pub(crate) fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut clipped: String = text.chars().take(max.saturating_sub(1)).collect();
    clipped.push('…');
    clipped
}

fn format_line(secs: u64, level: Level, target: &str, message: &str) -> String {
    let target: String = target
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        .take(40)
        .collect();
    serde_json::json!({
        "ts": utc_timestamp(secs),
        "level": level.label(),
        "target": target,
        "message": clip(&redact(message), MAX_MESSAGE),
    })
    .to_string()
}

fn rotated(path: &Path, n: usize) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{n}"));
    PathBuf::from(name)
}

/// Shifts `.log` to `.log.1`, `.log.1` to `.log.2` and so on; the oldest file is dropped.
fn rotate(path: &Path, files: usize) {
    if files <= 1 {
        let _ = std::fs::remove_file(path);
        return;
    }
    let _ = std::fs::remove_file(rotated(path, files - 1));
    for n in (1..files - 1).rev() {
        let from = rotated(path, n);
        if from.exists() {
            let _ = std::fs::rename(from, rotated(path, n + 1));
        }
    }
    let _ = std::fs::rename(path, rotated(path, 1));
}

fn write_line(path: &Path, max_bytes: u64, files: usize, line: &str) -> std::io::Result<()> {
    let size = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if size > 0 && size + line.len() as u64 + 1 > max_bytes {
        rotate(path, files);
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{line}")
}

fn read_recent(path: &Path, files: usize, max: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for n in 0..files {
        if lines.len() >= max {
            break;
        }
        let file = if n == 0 {
            path.to_path_buf()
        } else {
            rotated(path, n)
        };
        let Ok(text) = std::fs::read_to_string(file) else {
            continue;
        };
        let mut older: Vec<String> = text.lines().map(str::to_owned).collect();
        older.append(&mut lines);
        lines = older;
        if lines.len() > max {
            lines.drain(..lines.len() - max);
        }
    }
    lines
}

/// A short, fixed label for an error, so the log can say what kind of failure happened without
/// keeping any of its text.
pub fn error_category(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("signed out") || lower.contains("sign in to scalable") {
        "signed_out"
    } else if lower.contains("returned 401") || lower.contains("invalid_token") {
        "unauthorized"
    } else if lower.contains("returned 429") {
        "rate_limited"
    } else if lower.contains("returned 5") {
        "server_error"
    } else if lower.contains("returned 4") {
        "client_error"
    } else if lower.contains("trading") && lower.contains("off") {
        "trading_off"
    } else if lower.contains("signature") {
        "signature"
    } else if lower.contains("secure sign-in storage") || lower.contains("keyring") {
        "keyring"
    } else if lower.contains("callback listener") || lower.contains("already in progress") {
        "login_listener"
    } else if lower.contains("could not connect")
        || lower.contains("timed out")
        || lower.contains("error sending request")
        || lower.contains("dns")
        || lower.contains("connection")
    {
        "network"
    } else {
        "other"
    }
}

fn home_dir() -> Option<String> {
    std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
        .filter(|home| home.len() > 1)
}

/// Removes anything that looks like a secret or personal data: the home folder (becomes `~`),
/// bearer tokens, `token=`-style values, URL query strings and credentials, emails, JWTs and long
/// hex or base64 runs.
pub fn redact(text: &str) -> String {
    redact_with_home(text, home_dir().as_deref())
}

fn redact_with_home(text: &str, home: Option<&str>) -> String {
    let mut text = match home {
        Some(home) if home.len() > 1 => redact_home(text, home),
        _ => text.to_owned(),
    };
    text = redact_bearer(&text);
    for key in SECRET_KEYS {
        text = redact_values_of(&text, key);
    }
    text = redact_urls(&text);
    text = redact_emails(&text);
    redact_secrets(&text)
}

fn redact_home(text: &str, home: &str) -> String {
    let home = home.trim_end_matches(['/', '\\']);
    if home.is_empty() {
        return text.to_owned();
    }
    let mut out = text.replace(home, "~");
    let forward = home.replace('\\', "/");
    let backward = home.replace('/', "\\");
    for variant in [forward, backward] {
        if variant != home {
            out = out.replace(&variant, "~");
        }
    }
    out
}

fn redact_bearer(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut pos = 0;
    while let Some(found) = lower[pos..].find("bearer") {
        let after = pos + found + "bearer".len();
        out.push_str(&text[pos..after]);
        let rest = &text[after..];
        let space = rest.len() - rest.trim_start().len();
        let value = rest[space..]
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ','))
            .unwrap_or(rest.len() - space);
        if space > 0 && value > 0 {
            out.push_str(&rest[..space]);
            out.push_str(REDACTED);
            pos = after + space + value;
        } else {
            pos = after;
        }
    }
    out.push_str(&text[pos..]);
    out
}

fn redact_values_of(text: &str, key: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let bytes = text.as_bytes();
    let to_line_end = key == "authorization";
    let mut out = String::with_capacity(text.len());
    let mut pos = 0;
    while let Some(found) = lower[pos..].find(key) {
        let key_end = pos + found + key.len();
        let mut i = key_end;
        if i < bytes.len() && matches!(bytes[i], b'"' | b'\'') {
            i += 1;
        }
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t') {
            i += 1;
        }
        if !(i < bytes.len() && matches!(bytes[i], b'=' | b':')) {
            out.push_str(&text[pos..key_end]);
            pos = key_end;
            continue;
        }
        i += 1;
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t') {
            i += 1;
        }
        if i < bytes.len() && matches!(bytes[i], b'"' | b'\'') {
            i += 1;
        }
        let end = text[i..]
            .find(|c: char| {
                if to_line_end {
                    matches!(c, '\n' | '\r' | '"')
                } else {
                    c.is_whitespace() || matches!(c, '&' | '"' | '\'' | ',' | ';' | '}' | ')')
                }
            })
            .map_or(text.len(), |n| i + n);
        out.push_str(&text[pos..i]);
        if end > i {
            out.push_str(REDACTED);
        }
        pos = end.max(i);
    }
    out.push_str(&text[pos..]);
    out
}

fn redact_urls(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pos = 0;
    while let Some(found) = text[pos..].find("://") {
        let after = pos + found + 3;
        out.push_str(&text[pos..after]);
        let end = text[after..]
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | ')'))
            .map_or(text.len(), |n| after + n);
        let token = &text[after..end];
        let authority_end = token.find(['/', '?', '#']).unwrap_or(token.len());
        let host_start = token[..authority_end].rfind('@').map_or(0, |at| at + 1);
        out.push_str(&token[host_start..authority_end]);
        let rest = &token[authority_end..];
        match rest.find(['?', '#']) {
            Some(cut) => {
                out.push_str(&rest[..cut]);
                out.push_str("?[redacted]");
            }
            None => out.push_str(rest),
        }
        pos = end;
    }
    out.push_str(&text[pos..]);
    out
}

fn redact_emails(text: &str) -> String {
    let bytes = text.as_bytes();
    let local = |b: u8| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'%' | b'+' | b'-');
    let domain = |b: u8| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-');
    let mut out = String::with_capacity(text.len());
    let mut pos = 0;
    let mut search = 0;
    while let Some(found) = text[search..].find('@') {
        let at = search + found;
        let mut start = at;
        while start > pos && local(bytes[start - 1]) {
            start -= 1;
        }
        let mut end = at + 1;
        while end < bytes.len() && domain(bytes[end]) {
            end += 1;
        }
        let host = text[at + 1..end].trim_end_matches('.');
        if start < at && host.contains('.') && !host.starts_with('.') {
            out.push_str(&text[pos..start]);
            out.push_str("[email]");
            pos = at + 1 + host.len();
            search = pos;
        } else {
            search = at + 1;
        }
    }
    out.push_str(&text[pos..]);
    out
}

fn is_secret_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '+' | '_' | '=' | '-')
}

/// JWTs and runs of 32 or more hex or base64 characters, standard base64 with `/` included.
fn redact_secrets(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut run = String::new();
    for c in text.chars() {
        if is_secret_char(c) || matches!(c, '.' | '/') {
            run.push(c);
        } else {
            out.push_str(&redact_run(&run));
            run.clear();
            out.push(c);
        }
    }
    out.push_str(&redact_run(&run));
    out
}

fn redact_run(run: &str) -> String {
    if run.starts_with("eyJ") && run.matches('.').count() >= 2 {
        return "[jwt]".to_owned();
    }
    run.split('.')
        .map(|part| {
            if looks_base64(part) {
                return "[secret]".to_owned();
            }
            part.split('/')
                .map(|segment| {
                    if looks_secret(segment) {
                        "[secret]"
                    } else {
                        segment
                    }
                })
                .collect::<Vec<_>>()
                .join("/")
        })
        .collect::<Vec<_>>()
        .join(".")
}

/// Standard base64 with a `/` in it, which a path or URL path (lower-case words, `-`, `_` or a
/// leading `/`) does not look like: 32 or more characters of mixed case and digits.
fn looks_base64(part: &str) -> bool {
    part.len() >= 32
        && part.contains('/')
        && !part.starts_with('/')
        && part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '='))
        && part.chars().any(|c| c.is_ascii_digit())
        && part.chars().any(|c| c.is_ascii_uppercase())
        && part.chars().any(|c| c.is_ascii_lowercase())
        && !part
            .split('/')
            .any(|segment| segment.len() >= 3 && segment.chars().all(|c| c.is_ascii_lowercase()))
}

fn looks_secret(part: &str) -> bool {
    if part.len() < 32 {
        return false;
    }
    let digits = part.chars().any(|c| c.is_ascii_digit());
    let letters = part.chars().any(|c| c.is_ascii_alphabetic());
    part.chars().all(|c| c.is_ascii_hexdigit()) || (digits && letters)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sc-desktop-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn clean(text: &str) -> String {
        redact_with_home(text, None)
    }

    #[test]
    fn removes_bearer_tokens_and_authorization_headers() {
        let out = clean("sent Authorization: Bearer abc.def-123 to the server");
        assert!(!out.contains("abc.def"), "{out}");
        assert_eq!(
            clean("header bearer   Zm9vYmFy done"),
            "header bearer   [redacted] done"
        );
        let basic = clean("authorization: Basic dXNlcjpwYXNz\nnext line");
        assert!(!basic.contains("dXNlcjpwYXNz"), "{basic}");
        assert!(basic.contains("next line"));
    }

    #[test]
    fn removes_token_values_in_every_notation() {
        assert_eq!(
            redact_values_of("client_secret = abc123;", "client_secret"),
            "client_secret = [redacted];"
        );
        for text in [
            "access_token=abc123 ok",
            "{\"refresh_token\":\"abc123\"}",
            "id_token: abc123",
            "client_secret = abc123;",
            "code_verifier=abc123&x=1",
        ] {
            let out = clean(text);
            assert!(!out.contains("abc123"), "{text} -> {out}");
            assert!(out.contains(REDACTED), "{text} -> {out}");
        }
        assert_eq!(clean("error: invalid_token}"), "error: invalid_token}");
    }

    #[test]
    fn removes_jwts() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl";
        assert_eq!(clean(&format!("token was {jwt}!")), "token was [jwt]!");
    }

    #[test]
    fn removes_long_hex_and_base64_runs_but_not_ordinary_words() {
        let hex = "0123456789abcdef0123456789abcdef";
        assert_eq!(clean(&format!("id {hex} end")), "id [secret] end");
        let b64 = "dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQ5MTIz";
        assert_eq!(clean(&format!("key {b64}")), "key [secret]");
        assert_eq!(
            clean("Scalable MCP returned 502 while connecting to the server"),
            "Scalable MCP returned 502 while connecting to the server"
        );
        assert_eq!(
            clean("scalable-capital-desktop.exe"),
            "scalable-capital-desktop.exe"
        );
    }

    #[test]
    fn removes_standard_base64_with_slashes_but_keeps_paths_and_urls() {
        let b64 = "Zm9vYmFyYmF6cXV4/QUJDREVGR0hJSktMTU5P+UFFSU1RVVldYWVo9MTIz/NDU2Nzg5MA==";
        assert_eq!(
            clean(&format!("token was {b64} end")),
            "token was [secret] end"
        );
        assert_eq!(clean(b64), "[secret]");
        for text in [
            "/home/user/Projects2/scalable-capital-desktop/src-tauri/target",
            "src/Components/Button2/IndexFile/ThingHolder.tsx",
            "C:\\Users\\Me\\AppData\\Local\\Scalable2Capital\\logs",
        ] {
            assert_eq!(clean(text), text);
        }
        assert_eq!(
            clean("GET https://github.com/Owner1/RepoName/releases/latest/download/latest.json"),
            "GET https://github.com/Owner1/RepoName/releases/latest/download/latest.json"
        );
    }

    #[test]
    fn removes_query_strings_fragments_and_url_credentials() {
        assert_eq!(
            clean("GET https://example.com/cb?code=1&state=2 failed"),
            "GET https://example.com/cb?[redacted] failed"
        );
        assert_eq!(
            clean("see https://example.com/a#frag."),
            "see https://example.com/a?[redacted]"
        );
        assert_eq!(
            clean("at https://user:pw@example.com/path (retry)"),
            "at https://example.com/path (retry)"
        );
        assert_eq!(
            clean("plain https://example.com/path ok"),
            "plain https://example.com/path ok"
        );
    }

    #[test]
    fn removes_emails() {
        assert_eq!(
            clean("signed in as jane.doe+x@mail.example.com now"),
            "signed in as [email] now"
        );
        assert_eq!(
            clean("a @ b and user@localhost"),
            "a @ b and user@localhost"
        );
    }

    #[test]
    fn replaces_the_home_folder_with_a_tilde() {
        assert_eq!(
            redact_with_home("open /home/jane/.local/app.log", Some("/home/jane")),
            "open ~/.local/app.log"
        );
        assert_eq!(
            redact_with_home(
                "C:\\Users\\jane\\AppData and C:/Users/jane/x",
                Some("C:\\Users\\jane")
            ),
            "~\\AppData and ~/x"
        );
        assert_eq!(redact_with_home("/x", Some("/")), "/x");
    }

    #[test]
    fn categorizes_errors_without_keeping_their_text() {
        assert_eq!(
            error_category("Scalable MCP returned 401 Unauthorized: x"),
            "unauthorized"
        );
        assert_eq!(
            error_category("Scalable MCP returned 429 Too Many"),
            "rate_limited"
        );
        assert_eq!(error_category("Scalable MCP returned 503"), "server_error");
        assert_eq!(
            error_category("Could not connect to Scalable MCP: dns"),
            "network"
        );
        assert_eq!(
            error_category("You are signed out. Sign in to Scalable Capital again."),
            "signed_out"
        );
        assert_eq!(error_category("something with secret=abc"), "other");
    }

    #[test]
    fn formats_utc_timestamps() {
        assert_eq!(utc_timestamp(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc_timestamp(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(utc_timestamp(1_782_000_000), "2026-06-21T00:00:00Z");
    }

    #[test]
    fn a_log_line_is_redacted_json() {
        let line = format_line(0, Level::Warn, "au th!", "failed with access_token=abc123");
        let value: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["level"], "WARN");
        assert_eq!(value["target"], "auth");
        assert!(!value["message"].as_str().unwrap().contains("abc123"));
    }

    #[test]
    fn rotation_keeps_the_newest_files_within_the_limit() {
        let dir = temp_dir("rotate");
        let path = dir.join("app.log");
        for n in 0..12 {
            write_line(&path, 50, 3, &format!("line-{n:02}-xxxxxxxxxxxxxxxxxxxx")).unwrap();
        }
        assert!(path.exists());
        assert!(rotated(&path, 1).exists());
        assert!(rotated(&path, 2).exists());
        assert!(!rotated(&path, 3).exists());
        let all = read_recent(&path, 3, 100);
        assert_eq!(all.last().unwrap(), "line-11-xxxxxxxxxxxxxxxxxxxx");
        assert!(all.len() <= 6, "{all:?}");
        assert!(!all
            .iter()
            .any(|line| line == "line-00-xxxxxxxxxxxxxxxxxxxx"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn recent_lines_returns_the_newest_oldest_first() {
        let dir = temp_dir("recent");
        let path = dir.join("app.log");
        for n in 0..5 {
            write_line(&path, 1_000_000, 3, &format!("l{n}")).unwrap();
        }
        assert_eq!(read_recent(&path, 3, 2), vec!["l3", "l4"]);
        assert!(read_recent(&dir.join("missing.log"), 3, 2).is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
