use super::{
    args::validate_arguments,
    client::{require_tool, McpClient},
    trading::{is_read_tool, TradingGate, TRADING_OFF},
};
use crate::{auth, logging};
use serde_json::Value;
use std::{future::Future, time::Duration, time::Instant};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

/// A cached session is reused for at most this long, so a changed tool list is picked up.
pub const SESSION_MAX_AGE: Duration = Duration::from_secs(600);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Retry {
    ReadOnly,
    Never,
}

struct CachedSession {
    client: McpClient,
    tools: Vec<Value>,
    token: String,
    created: Instant,
}

/// One MCP session shared by every command. It is created on first use and replaced when it is
/// older than `SESSION_MAX_AGE`, when the access token changed, or after `invalidate`.
#[derive(Default)]
pub struct SessionPool {
    cached: Mutex<Option<CachedSession>>,
}

impl SessionPool {
    /// Drops the cached session (sign-out, token renewal, or a stale-session error).
    pub async fn clear(&self) {
        *self.cached.lock().await = None;
    }
}

/// Drops the current MCP session after waking from sleep so the next request starts a fresh handshake.
#[tauri::command]
pub async fn invalidate_session(pool: State<'_, SessionPool>) -> Result<(), String> {
    pool.clear().await;
    Ok(())
}

/// The reuse decision, kept pure so it can be tested: `cached` is the token and age of the
/// current session, `None` when there is none (never created, or invalidated).
pub fn needs_new_session(cached: Option<(&str, Duration)>, current_token: &str) -> bool {
    match cached {
        None => true,
        Some((token, age)) => token != current_token || age >= SESSION_MAX_AGE,
    }
}

/// True for errors that mean the session or token was rejected before Scalable did any work:
/// the request can be repeated on a fresh session.
pub fn is_stale_session_error(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.starts_with("scalable mcp returned 401")
        || lower.starts_with("scalable mcp returned 404")
        || lower.contains("invalid_token")
        || lower.contains("session not found")
        || lower.contains("invalid session")
        || lower.contains("unknown session")
}

async fn establish(access_token: &str) -> Result<(McpClient, Vec<Value>), String> {
    let mut client = McpClient::new(access_token.to_owned());
    let tools = match client.initialize().await {
        Ok(()) => client.list_tools().await,
        Err(error) => Err(error),
    }
    .inspect_err(|error| logging::log_failure("mcp", "session setup", error))?;
    Ok((client, tools))
}

/// Whether Trading is switched on, for the diagnostics report.
pub fn trading_enabled(app: &AppHandle) -> bool {
    app.state::<TradingGate>().is_on()
}

async fn signed_in_token(app: &AppHandle) -> Result<String, String> {
    auth::current_access_token(app)
        .await?
        .ok_or_else(|| "You are signed out. Sign in to Scalable Capital again.".to_owned())
}

/// The shared client and its tool list. Concurrent callers wait for one handshake instead of
/// each opening a session.
pub async fn connect(app: &AppHandle) -> Result<(McpClient, Vec<Value>), String> {
    let token = signed_in_token(app).await?;
    let pool = app.state::<SessionPool>();
    let mut cached = pool.cached.lock().await;
    let reuse = cached
        .as_ref()
        .map(|session| (session.token.as_str(), session.created.elapsed()));
    if !needs_new_session(reuse, &token) {
        if let Some(session) = cached.as_ref() {
            return Ok((session.client.clone(), session.tools.clone()));
        }
    }
    store(&mut cached, &token).await
}

/// Always opens a new session and makes it the shared one. Used by dashboard loads (a refresh
/// should see the current tool list) and by order submission (never ride on a stale session).
pub async fn connect_fresh(app: &AppHandle) -> Result<(McpClient, Vec<Value>), String> {
    let token = signed_in_token(app).await?;
    let pool = app.state::<SessionPool>();
    let mut cached = pool.cached.lock().await;
    store(&mut cached, &token).await
}

async fn store(
    cached: &mut Option<CachedSession>,
    token: &str,
) -> Result<(McpClient, Vec<Value>), String> {
    *cached = None;
    let (client, tools) = establish(token).await?;
    *cached = Some(CachedSession {
        client: client.clone(),
        tools: tools.clone(),
        token: token.to_owned(),
        created: Instant::now(),
    });
    Ok((client, tools))
}

/// Forgets the shared session so the next `connect` opens a new one.
pub async fn invalidate(app: &AppHandle) {
    app.state::<SessionPool>().clear().await;
}

/// Runs `operation` on the shared session. If Scalable rejects the session or token, the cache is
/// dropped and the operation runs once more on a new session. Only use it for operations that
/// are safe to repeat after a rejected request.
pub async fn with_session<T, F, Fut>(app: &AppHandle, operation: F) -> Result<T, String>
where
    F: Fn(McpClient, Vec<Value>) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let (client, tools) = connect(app).await?;
    match operation(client, tools).await {
        Err(error) if is_stale_session_error(&error) => {
            invalidate(app).await;
            let (client, tools) = connect(app).await?;
            operation(client, tools).await
        }
        other => other,
    }
}

fn validate_retry_policy(name: &str, retry: Retry) -> Result<(), String> {
    if retry == Retry::ReadOnly && !is_read_tool(name) {
        return Err(format!(
            "Refusing to run non-read MCP tool {name} as read-only"
        ));
    }
    Ok(())
}

fn requires_trading(name: &str) -> bool {
    !is_read_tool(name) || name.trim().to_ascii_lowercase().starts_with("preview_")
}

/// Calls one MCP tool with an explicit retry policy. Read-only calls may be repeated once after a
/// rejected session; all other calls use a fresh session and are never repeated.
pub async fn call_tool(
    app: &AppHandle,
    name: &str,
    arguments: Value,
    retry: Retry,
    unavailable_msg: &str,
) -> Result<Value, String> {
    validate_retry_policy(name, retry)?;
    let (mut client, tools) = match retry {
        Retry::ReadOnly => connect(app).await?,
        Retry::Never => connect_fresh(app).await?,
    };
    let tool = require_tool(&tools, name).map_err(|_| unavailable_msg.to_owned())?;
    validate_arguments(tool, &arguments)?;
    if requires_trading(name) && !app.state::<TradingGate>().is_on() {
        return Err(TRADING_OFF.to_owned());
    }
    let result = match client.call_tool(name, arguments.clone()).await {
        Err(error) if retry == Retry::ReadOnly && is_stale_session_error(&error) => {
            invalidate(app).await;
            let (mut client, tools) = connect(app).await?;
            let tool = require_tool(&tools, name).map_err(|_| unavailable_msg.to_owned())?;
            validate_arguments(tool, &arguments)?;
            if requires_trading(name) && !app.state::<TradingGate>().is_on() {
                return Err(TRADING_OFF.to_owned());
            }
            client.call_tool(name, arguments).await
        }
        result => result,
    };
    if let Err(error) = &result {
        logging::log_failure("mcp", "tool call", error);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRESH: Duration = Duration::from_secs(30);

    #[test]
    fn a_young_session_with_the_same_token_is_reused() {
        assert!(!needs_new_session(Some(("t1", FRESH)), "t1"));
        assert!(!needs_new_session(
            Some(("t1", SESSION_MAX_AGE - Duration::from_secs(1))),
            "t1"
        ));
    }

    #[test]
    fn an_old_session_is_replaced() {
        assert!(needs_new_session(Some(("t1", SESSION_MAX_AGE)), "t1"));
    }

    #[test]
    fn a_new_access_token_replaces_the_session() {
        assert!(needs_new_session(Some(("t1", FRESH)), "t2"));
    }

    #[test]
    fn a_missing_or_invalidated_session_is_created() {
        assert!(needs_new_session(None, "t1"));
    }

    #[test]
    fn recognises_rejected_sessions_but_not_tool_failures() {
        assert!(is_stale_session_error(
            "Scalable MCP returned 401 Unauthorized: {\"error\":\"invalid_token\"}"
        ));
        assert!(is_stale_session_error(
            "Scalable MCP returned 404 Not Found: "
        ));
        assert!(is_stale_session_error(
            "Scalable MCP request failed: {\"message\":\"Session not found\"}"
        ));
        assert!(!is_stale_session_error(
            "Scalable MCP tool get_security_quote failed: not found"
        ));
        assert!(!is_stale_session_error(
            "Scalable MCP returned 429 Too Many Requests: "
        ));
        assert!(!is_stale_session_error(
            "Could not connect to Scalable MCP: timed out"
        ));
    }

    #[test]
    fn read_only_retry_policy_refuses_non_read_tools() {
        assert!(validate_retry_policy("get_security_quote", Retry::ReadOnly).is_ok());
        assert!(validate_retry_policy("submit_buy_order", Retry::ReadOnly).is_err());
        assert!(validate_retry_policy("unknown_tool", Retry::ReadOnly).is_err());
        assert!(validate_retry_policy("submit_buy_order", Retry::Never).is_ok());
        assert!(requires_trading("preview_sell_order"));
        assert!(requires_trading("unknown_tool"));
        assert!(!requires_trading("get_security_quote"));
    }

    #[tokio::test]
    async fn clear_empties_the_pool() {
        let pool = SessionPool::default();
        *pool.cached.lock().await = Some(CachedSession {
            client: McpClient::new("t".to_owned()),
            tools: Vec::new(),
            token: "t".to_owned(),
            created: Instant::now(),
        });
        pool.clear().await;
        assert!(pool.cached.lock().await.is_none());
    }
}
