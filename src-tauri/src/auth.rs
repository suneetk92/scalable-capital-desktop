use crate::logging;
use crate::mcp::{
    savings::SavingsState,
    session::SessionPool,
    trading::{self, TradeState, TradingGate},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::distr::Alphanumeric;
use rand::RngExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::{timeout_at, Duration, Instant},
};
use url::Url;

pub const MCP_ENDPOINT: &str = "https://mcp.scalable.capital/mcp";
const RESOURCE_METADATA_URL: &str =
    "https://mcp.scalable.capital/.well-known/oauth-protected-resource/mcp";
/// The OAuth metadata is fetched from Scalable, so the issuer and every endpoint it names must stay
/// on this domain: a tampered or misconfigured metadata document cannot send the code or the
/// tokens anywhere else.
const OAUTH_DOMAIN: &str = "scalable.capital";
const REDIRECT_PORT: u16 = 43127;
const REDIRECT_URI: &str = "http://127.0.0.1:43127/";
const OAUTH_SCOPES: &str = "openid profile offline_access";
const OAUTH_HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);
const CALLBACK_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const KEYRING_SERVICE: &str = "com.sk.scalable-capital-desktop";
const KEYRING_USER: &str = "scalable-capital-oauth";
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    pub status: String,
    pub error: Option<String>,
}

impl Default for LoginStatus {
    fn default() -> Self {
        Self {
            status: "idle".to_owned(),
            error: None,
        }
    }
}

#[derive(Default)]
pub struct AuthState {
    login_status: Mutex<LoginStatus>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthClient {
    client_id: String,
    redirect_uri: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct OAuthTokens {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    client_id: String,
    /// Unix seconds of the interactive sign-in.
    #[serde(default)]
    signed_in_at: Option<u64>,
    /// Unix seconds when the current refresh token was issued.
    #[serde(default)]
    refresh_issued_at: Option<u64>,
    /// Only set when Scalable's token response states a refresh-token lifetime.
    #[serde(default)]
    refresh_expires_at: Option<u64>,
}

/// What the UI may know about the session. It never contains a token.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub signed_in: bool,
    pub signed_in_at: Option<u64>,
    pub access_expires_at: Option<u64>,
    pub refresh_issued_at: Option<u64>,
    /// `None` means Scalable does not publish the refresh-token lifetime.
    pub refresh_expires_at: Option<u64>,
}

impl SessionInfo {
    fn from_tokens(tokens: Option<&OAuthTokens>) -> Self {
        match tokens {
            Some(tokens) => Self {
                signed_in: true,
                signed_in_at: tokens.signed_in_at,
                access_expires_at: Some(tokens.expires_at),
                refresh_issued_at: tokens.refresh_issued_at,
                refresh_expires_at: tokens.refresh_expires_at,
            },
            None => Self {
                signed_in: false,
                signed_in_at: None,
                access_expires_at: None,
                refresh_issued_at: None,
                refresh_expires_at: None,
            },
        }
    }
}

#[derive(Deserialize)]
struct ProtectedResourceMetadata {
    authorization_servers: Vec<String>,
}

#[derive(Clone, Deserialize)]
struct AuthorizationServerMetadata {
    authorization_endpoint: String,
    token_endpoint: String,
    registration_endpoint: String,
    #[serde(default)]
    code_challenge_methods_supported: Vec<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    /// Not part of the OAuth standard; some servers send one of these two names.
    refresh_token_expires_in: Option<u64>,
    refresh_expires_in: Option<u64>,
}

impl TokenResponse {
    fn refresh_lifetime(&self) -> Option<u64> {
        self.refresh_token_expires_in.or(self.refresh_expires_in)
    }
}

#[tauri::command]
pub async fn begin_login(app: AppHandle, state: State<'_, AuthState>) -> Result<String, String> {
    {
        let status = state
            .login_status
            .lock()
            .map_err(|_| "Authentication state is unavailable".to_owned())?;
        if status.status == "pending" {
            return Err("A Scalable sign-in is already in progress".to_owned());
        }
    }

    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
        .await
        .map_err(|error| format!("Could not start the sign-in callback listener: {error}"))?;
    let client = http_client();
    let metadata = discover_oauth(&client).await?;
    let client_id = register_or_load_client(&app, &client, &metadata).await?;
    let verifier = random_string(64);
    let state_value = random_string(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut authorization_url = Url::parse(&metadata.authorization_endpoint)
        .map_err(|error| format!("Invalid authorization endpoint: {error}"))?;
    authorization_url
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", OAUTH_SCOPES)
        .append_pair("state", &state_value)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("resource", MCP_ENDPOINT);

    {
        let mut status = state
            .login_status
            .lock()
            .map_err(|_| "Authentication state is unavailable".to_owned())?;
        *status = LoginStatus {
            status: "pending".to_owned(),
            error: None,
        };
    }

    let app_handle = app.clone();
    let token_endpoint = metadata.token_endpoint;
    tauri::async_runtime::spawn(async move {
        let result = complete_login(
            listener,
            &client_id,
            &token_endpoint,
            &state_value,
            &verifier,
        )
        .await;
        match result {
            Ok(tokens) => {
                let _guard = REFRESH_LOCK.lock().await;
                let status = match save_tokens_async(tokens).await {
                    Ok(()) => LoginStatus {
                        status: "authenticated".to_owned(),
                        error: None,
                    },
                    Err(error) => LoginStatus {
                        status: "failed".to_owned(),
                        error: Some(error),
                    },
                };
                set_login_status(&app_handle, status);
            }
            Err(error) => set_login_status(
                &app_handle,
                LoginStatus {
                    status: "failed".to_owned(),
                    error: Some(error),
                },
            ),
        }
    });

    Ok(authorization_url.to_string())
}

#[tauri::command]
pub fn login_status(state: State<'_, AuthState>) -> Result<LoginStatus, String> {
    state
        .login_status
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "Authentication state is unavailable".to_owned())
}

/// Signing out also switches Trading off and drops any pending preview, so the next sign-in starts
/// read-only like a fresh launch, even if the webview never sends the switch again.
#[tauri::command]
pub async fn logout(
    state: State<'_, AuthState>,
    pool: State<'_, SessionPool>,
    gate: State<'_, TradingGate>,
    trade: State<'_, TradeState>,
    plans: State<'_, SavingsState>,
) -> Result<(), String> {
    trading::switch_trading(&gate, &trade, &plans, false);
    let _guard = REFRESH_LOCK.lock().await;
    clear_tokens_async().await?;
    pool.clear().await;
    let mut status = state
        .login_status
        .lock()
        .map_err(|_| "Authentication state is unavailable".to_owned())?;
    *status = LoginStatus::default();
    Ok(())
}

/// Returns a fresh access token (refreshing it if needed) so it can be copied, e.g. to test the MCP endpoint with curl.
#[tauri::command]
pub async fn get_access_token(app: AppHandle) -> Result<String, String> {
    current_access_token(&app)
        .await?
        .ok_or_else(|| "You are signed out. Sign in to Scalable Capital first.".to_owned())
}

/// Whether sign-in data is stored. Reads it without refreshing or exposing anything.
pub async fn is_signed_in() -> bool {
    matches!(load_tokens_async().await, Ok(Some(_)))
}

pub async fn current_access_token(_app: &AppHandle) -> Result<Option<String>, String> {
    Ok(refresh_and_save(false)
        .await?
        .map(|tokens| tokens.access_token))
}

/// Refreshes the tokens and stores them. A rejected refresh token signs the user out (`Ok(None)`).
async fn refresh_and_save(force: bool) -> Result<Option<OAuthTokens>, String> {
    let _guard = REFRESH_LOCK.lock().await;
    let Some(mut tokens) = load_tokens_async().await? else {
        return Ok(None);
    };
    if !force && tokens.expires_at > now_seconds().saturating_add(60) {
        return Ok(Some(tokens));
    }
    if tokens.refresh_token.is_empty() {
        clear_tokens_async().await?;
        return Ok(None);
    }
    let client = http_client();
    let metadata = discover_oauth(&client).await?;
    match refresh_tokens(&client, &metadata, &mut tokens).await {
        Ok(()) => {
            save_tokens_async(tokens.clone()).await?;
            Ok(Some(tokens))
        }
        Err(error) if error.contains("invalid_grant") || error.contains("invalid_token") => {
            clear_tokens_async().await?;
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

/// Sign-ins stored before the sign-in time was recorded have no `signed_in_at`. Fill it in with the
/// first time the session is read, so the panel shows a time instead of "Unknown". Returns true if changed.
fn backfill_signed_in_at(tokens: &mut OAuthTokens, now: u64) -> bool {
    if tokens.signed_in_at.is_some() {
        return false;
    }
    tokens.signed_in_at = Some(now);
    true
}

/// Validity of the stored tokens, for the Settings "Session" panel.
#[tauri::command]
pub async fn get_session_info() -> Result<SessionInfo, String> {
    let _guard = REFRESH_LOCK.lock().await;
    let mut tokens = load_tokens_async().await?;
    if let Some(tokens) = tokens.as_mut() {
        if backfill_signed_in_at(tokens, now_seconds()) {
            save_tokens_async(tokens.clone()).await?;
        }
    }
    Ok(SessionInfo::from_tokens(tokens.as_ref()))
}

/// Renews the access token now, even if it is still valid.
#[tauri::command]
pub async fn refresh_session(pool: State<'_, SessionPool>) -> Result<SessionInfo, String> {
    let refreshed = refresh_and_save(true).await?;
    pool.clear().await;
    Ok(SessionInfo::from_tokens(refreshed.as_ref()))
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(OAUTH_HTTP_TIMEOUT)
        .build()
        .unwrap_or_default()
}

fn set_login_status(app: &AppHandle, status: LoginStatus) {
    match (status.status.as_str(), status.error.as_deref()) {
        ("authenticated", _) => {
            logging::log_event(logging::Level::Info, "auth", "sign-in succeeded")
        }
        ("failed", error) => logging::log_failure("auth", "sign-in", error.unwrap_or_default()),
        _ => {}
    }
    if let Some(state) = app.try_state::<AuthState>() {
        if let Ok(mut current) = state.login_status.lock() {
            *current = status;
        }
    }
}

async fn discover_oauth(client: &reqwest::Client) -> Result<AuthorizationServerMetadata, String> {
    let resource_metadata: ProtectedResourceMetadata = client
        .get(RESOURCE_METADATA_URL)
        .send()
        .await
        .map_err(|error| format!("Could not discover Scalable MCP authorization: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Scalable MCP resource discovery failed: {error}"))?
        .json()
        .await
        .map_err(|error| format!("Invalid Scalable MCP resource metadata: {error}"))?;
    let issuer = resource_metadata
        .authorization_servers
        .first()
        .ok_or_else(|| "Scalable MCP did not advertise an authorization server".to_owned())?;
    let mut issuer_url = validate_https_endpoint(issuer, "authorization server")?;
    let issuer_path = issuer_url.path().trim_end_matches('/').to_owned();
    issuer_url.set_path(&format!(
        "/.well-known/oauth-authorization-server{issuer_path}"
    ));
    let metadata: AuthorizationServerMetadata = client
        .get(issuer_url)
        .send()
        .await
        .map_err(|error| format!("Could not discover Scalable OAuth endpoints: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Scalable OAuth discovery failed: {error}"))?
        .json()
        .await
        .map_err(|error| format!("Invalid Scalable OAuth metadata: {error}"))?;
    if !metadata
        .code_challenge_methods_supported
        .iter()
        .any(|method| method == "S256")
    {
        return Err("Scalable OAuth metadata does not support PKCE S256".to_owned());
    }
    validate_https_endpoint(&metadata.authorization_endpoint, "authorization endpoint")?;
    validate_https_endpoint(&metadata.token_endpoint, "token endpoint")?;
    validate_https_endpoint(&metadata.registration_endpoint, "registration endpoint")?;
    Ok(metadata)
}

fn validate_https_endpoint(endpoint: &str, label: &str) -> Result<Url, String> {
    let url = Url::parse(endpoint).map_err(|_| format!("Invalid Scalable OAuth {label} URL"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(format!("Scalable OAuth {label} must use HTTPS"));
    }
    if !url.host_str().is_some_and(is_allowed_oauth_host) {
        return Err(format!("Scalable OAuth {label} is not on {OAUTH_DOMAIN}"));
    }
    Ok(url)
}

/// `scalable.capital` itself or one of its subdomains, compared case-insensitively.
fn is_allowed_oauth_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == OAUTH_DOMAIN
        || host
            .strip_suffix(OAUTH_DOMAIN)
            .is_some_and(|prefix| prefix.ends_with('.') && prefix.len() > 1)
}

async fn register_or_load_client(
    app: &AppHandle,
    client: &reqwest::Client,
    metadata: &AuthorizationServerMetadata,
) -> Result<String, String> {
    let path = client_config_path(app)?;
    let read_path = path.clone();
    let existing = tokio::task::spawn_blocking(move || fs::read_to_string(read_path))
        .await
        .map_err(|error| format!("Could not read OAuth client information: {error}"))?;
    if let Ok(contents) = existing {
        if let Ok(existing) = serde_json::from_str::<OAuthClient>(&contents) {
            if existing.redirect_uri == REDIRECT_URI {
                return Ok(existing.client_id);
            }
        }
    }

    let response = client
        .post(&metadata.registration_endpoint)
        .json(&json!({
            "client_name": "Scalable Capital Desktop Desktop",
            "redirect_uris": [REDIRECT_URI],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": OAUTH_SCOPES,
        }))
        .send()
        .await
        .map_err(|error| format!("Could not register the desktop OAuth client: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Could not read OAuth registration response: {error}"))?;
    if !status.is_success() {
        return Err(sanitize_oauth_error(status.as_u16(), &body));
    }
    let registration: Value = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid OAuth registration response: {error}"))?;
    let client_id = registration
        .get("client_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OAuth registration response did not include a client ID".to_owned())?
        .to_owned();
    let contents = serde_json::to_vec(&OAuthClient {
        client_id: client_id.clone(),
        redirect_uri: REDIRECT_URI.to_owned(),
    })
    .map_err(|error| format!("Could not serialize OAuth client information: {error}"))?;
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create app data directory: {error}"))?;
        }
        fs::write(path, contents)
            .map_err(|error| format!("Could not save OAuth client information: {error}"))
    })
    .await
    .map_err(|error| format!("Could not save OAuth client information: {error}"))??;
    Ok(client_id)
}

fn client_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    Ok(directory.join("oauth-client.json"))
}

async fn complete_login(
    listener: TcpListener,
    client_id: &str,
    token_endpoint: &str,
    expected_state: &str,
    verifier: &str,
) -> Result<OAuthTokens, String> {
    let deadline = Instant::now() + CALLBACK_TIMEOUT;
    loop {
        let (mut stream, _) = timeout_at(deadline, listener.accept())
            .await
            .map_err(|_| "Scalable sign-in timed out. Please try again.".to_owned())?
            .map_err(|error| format!("Could not receive the Scalable sign-in callback: {error}"))?;
        let read_deadline = (Instant::now() + CALLBACK_REQUEST_TIMEOUT).min(deadline);
        let (method, path, request_error) =
            match timeout_at(read_deadline, read_callback(&mut stream)).await {
                Ok(result) => result,
                Err(_) => {
                    write_callback_response(
                        &mut stream,
                        "408 Request Timeout",
                        "Request timed out.",
                    )
                    .await;
                    continue;
                }
            };
        if request_error.is_some() {
            write_callback_response(&mut stream, "400 Bad Request", "Invalid callback request.")
                .await;
            continue;
        }
        if method != "GET" {
            write_callback_response(&mut stream, "405 Method Not Allowed", "Use GET.").await;
            continue;
        }
        let callback_url = match Url::parse(&format!("http://127.0.0.1{path}")) {
            Ok(url) if url.host_str() == Some("127.0.0.1") && url.path() == "/" => url,
            _ => {
                write_callback_response(&mut stream, "400 Bad Request", "Invalid callback URL.")
                    .await;
                continue;
            }
        };
        let query: std::collections::HashMap<String, String> = callback_url
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        if query.get("state").map(String::as_str) != Some(expected_state) {
            write_callback_response(
                &mut stream,
                "400 Bad Request",
                "Sign-in state did not match.",
            )
            .await;
            continue;
        }
        write_callback_response(
            &mut stream,
            "200 OK",
            "Sign-in finished. You can return to Scalable Capital Desktop.",
        )
        .await;
        if let Some(error) = query.get("error") {
            return Err(format!(
                "Scalable sign-in was not completed: {}",
                sanitize_oauth_code(error).unwrap_or_else(|| "OAuth error".to_owned())
            ));
        }
        let code = query
            .get("code")
            .filter(|code| !code.is_empty())
            .ok_or_else(|| {
                "Scalable sign-in callback did not include an authorization code".to_owned()
            })?;
        return exchange_authorization_code(client_id, token_endpoint, code, verifier).await;
    }
}

async fn read_callback(stream: &mut TcpStream) -> (String, String, Option<String>) {
    const MAX_CALLBACK_BYTES: usize = 8192;
    let mut bytes = Vec::with_capacity(1024);
    loop {
        let mut chunk = [0; 1024];
        let read_size = (MAX_CALLBACK_BYTES - bytes.len()).min(chunk.len());
        let count = match stream.read(&mut chunk[..read_size]).await {
            Ok(count) => count,
            Err(_) => {
                return (
                    String::new(),
                    String::new(),
                    Some("Could not read callback".to_owned()),
                )
            }
        };
        if count == 0 {
            return (
                String::new(),
                String::new(),
                Some("Incomplete callback request".to_owned()),
            );
        }
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            return parse_callback_request(&String::from_utf8_lossy(&bytes));
        }
        if bytes.len() == MAX_CALLBACK_BYTES {
            return (
                String::new(),
                String::new(),
                Some("Callback request is too large".to_owned()),
            );
        }
    }
}

fn parse_callback_request(request: &str) -> (String, String, Option<String>) {
    let Some(line) = request.lines().next() else {
        return (
            String::new(),
            String::new(),
            Some("Missing request line".to_owned()),
        );
    };
    let mut parts = line.split_whitespace();
    let (Some(method), Some(path), Some(version)) = (parts.next(), parts.next(), parts.next())
    else {
        return (
            String::new(),
            String::new(),
            Some("Malformed request line".to_owned()),
        );
    };
    if parts.next().is_some()
        || !matches!(version, "HTTP/1.0" | "HTTP/1.1")
        || !path.starts_with('/')
        || path.starts_with("//")
        || path.contains('#')
    {
        return (
            String::new(),
            String::new(),
            Some("Malformed request line".to_owned()),
        );
    }
    (method.to_owned(), path.to_owned(), None)
}

async fn write_callback_response(stream: &mut TcpStream, status: &str, message: &str) {
    let body = format!("<!doctype html><title>Scalable Capital Desktop</title><p>{message}</p>");
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

async fn exchange_authorization_code(
    client_id: &str,
    token_endpoint: &str,
    code: &str,
    verifier: &str,
) -> Result<OAuthTokens, String> {
    let client = http_client();
    let response = client
        .post(token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
            ("code_verifier", verifier),
            ("resource", MCP_ENDPOINT),
        ])
        .send()
        .await
        .map_err(|error| format!("Could not exchange Scalable authorization code: {error}"))?;
    let token_response = read_token_response(response).await?;
    Ok(tokens_from_login(token_response, client_id, now_seconds()))
}

fn tokens_from_login(response: TokenResponse, client_id: &str, now: u64) -> OAuthTokens {
    let mut tokens = OAuthTokens {
        access_token: String::new(),
        refresh_token: String::new(),
        expires_at: 0,
        client_id: client_id.to_owned(),
        signed_in_at: Some(now),
        refresh_issued_at: None,
        refresh_expires_at: None,
    };
    apply_token_response(&mut tokens, response, now);
    tokens
}

fn apply_token_response(tokens: &mut OAuthTokens, response: TokenResponse, now: u64) {
    let lifetime = response.refresh_lifetime();
    tokens.expires_at = now.saturating_add(response.expires_in.unwrap_or(3600));
    tokens.access_token = response.access_token;
    if let Some(refresh_token) = response.refresh_token {
        tokens.refresh_token = refresh_token;
        tokens.refresh_issued_at = Some(now);
        tokens.refresh_expires_at = lifetime.map(|seconds| now.saturating_add(seconds));
    } else if let Some(seconds) = lifetime {
        tokens.refresh_expires_at = Some(now.saturating_add(seconds));
    }
}

async fn refresh_tokens(
    client: &reqwest::Client,
    metadata: &AuthorizationServerMetadata,
    tokens: &mut OAuthTokens,
) -> Result<(), String> {
    let response = client
        .post(&metadata.token_endpoint)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", tokens.client_id.as_str()),
            ("refresh_token", tokens.refresh_token.as_str()),
            ("resource", MCP_ENDPOINT),
        ])
        .send()
        .await
        .map_err(|error| format!("Could not refresh Scalable sign-in: {error}"))?;
    let token_response = read_token_response(response).await?;
    apply_token_response(tokens, token_response, now_seconds());
    Ok(())
}

async fn read_token_response(response: reqwest::Response) -> Result<TokenResponse, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Could not read Scalable token response: {error}"))?;
    if !status.is_success() {
        return Err(sanitize_oauth_error(status.as_u16(), &body));
    }
    serde_json::from_str(&body).map_err(|error| format!("Invalid Scalable token response: {error}"))
}

fn sanitize_oauth_code(value: &str) -> Option<String> {
    (!value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')))
    .then(|| value.to_owned())
}

fn sanitize_oauth_error(status: u16, body: &str) -> String {
    let code = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .and_then(|value| sanitize_oauth_code(&value));
    match code {
        Some(code) => format!("OAuth request failed ({status}): {code}"),
        None => format!("OAuth request failed ({status})"),
    }
}

const KEYRING_CHUNK_CHARS: usize = 800;
const KEYRING_HEADER_PREFIX: &str = "chunks:";
const KEYRING_MAX_CHUNKS: usize = 64;

fn keyring_entry_for(user: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, user)
        .map_err(|error| format!("Could not access secure sign-in storage: {error}"))
}

fn keyring_chunk_entry(index: usize) -> Result<keyring::Entry, String> {
    keyring_entry_for(&format!("{KEYRING_USER}-{index}"))
}

fn read_chunk_count(header: &str) -> Result<usize, String> {
    let count = header
        .strip_prefix(KEYRING_HEADER_PREFIX)
        .ok_or_else(|| "Secure sign-in storage has an invalid header".to_owned())?
        .parse::<usize>()
        .map_err(|_| "Secure sign-in storage has an invalid header".to_owned())?;
    if count == 0 || count > KEYRING_MAX_CHUNKS {
        return Err("Secure sign-in storage has an invalid chunk count".to_owned());
    }
    Ok(count)
}

fn delete_entry(entry: &keyring::Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not clear secure sign-in storage: {error}")),
    }
}

fn load_tokens() -> Result<Option<OAuthTokens>, String> {
    let entry = keyring_entry_for(KEYRING_USER)?;
    let header = match entry.get_password() {
        Ok(contents) => contents,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("Could not read secure sign-in storage: {error}")),
    };
    let count = read_chunk_count(&header)?;
    let mut contents = String::new();
    for index in 0..count {
        match keyring_chunk_entry(index)?.get_password() {
            Ok(part) => contents.push_str(&part),
            Err(keyring::Error::NoEntry) => {
                return Err("Stored Scalable sign-in data is incomplete".to_owned());
            }
            Err(error) => {
                return Err(format!("Could not read secure sign-in storage: {error}"));
            }
        }
    }
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|error| format!("Stored Scalable sign-in data is invalid: {error}"))
}

fn save_tokens(tokens: &OAuthTokens) -> Result<(), String> {
    let contents = serde_json::to_string(tokens)
        .map_err(|error| format!("Could not serialize Scalable sign-in data: {error}"))?;
    let chars: Vec<char> = contents.chars().collect();
    let chunks: Vec<String> = chars
        .chunks(KEYRING_CHUNK_CHARS)
        .map(|part| part.iter().collect())
        .collect();

    let header_entry = keyring_entry_for(KEYRING_USER)?;
    let previous_count = match header_entry.get_password() {
        Ok(header) => read_chunk_count(&header).unwrap_or(KEYRING_MAX_CHUNKS),
        Err(keyring::Error::NoEntry) => 0,
        Err(error) => return Err(format!("Could not read secure sign-in storage: {error}")),
    };

    if chunks.len() > KEYRING_MAX_CHUNKS {
        return Err("Secure sign-in data exceeds the supported size".to_owned());
    }

    for (index, chunk) in chunks.iter().enumerate() {
        keyring_chunk_entry(index)?
            .set_password(chunk)
            .map_err(|error| format!("Could not store sign-in data securely: {error}"))?;
    }
    header_entry
        .set_password(&format!("{KEYRING_HEADER_PREFIX}{}", chunks.len()))
        .map_err(|error| format!("Could not store sign-in data securely: {error}"))?;
    for index in chunks.len()..previous_count {
        delete_entry(&keyring_chunk_entry(index)?)?;
    }
    Ok(())
}

fn clear_tokens() -> Result<(), String> {
    let header_entry = keyring_entry_for(KEYRING_USER)?;
    let count = match header_entry.get_password() {
        Ok(header) => read_chunk_count(&header).unwrap_or(KEYRING_MAX_CHUNKS),
        Err(keyring::Error::NoEntry) => 0,
        Err(error) => return Err(format!("Could not read secure sign-in storage: {error}")),
    };
    for index in 0..count {
        delete_entry(&keyring_chunk_entry(index)?)?;
    }
    delete_entry(&header_entry)
}

async fn load_tokens_async() -> Result<Option<OAuthTokens>, String> {
    tokio::task::spawn_blocking(load_tokens)
        .await
        .map_err(|error| format!("Could not read secure sign-in storage: {error}"))?
}

async fn save_tokens_async(tokens: OAuthTokens) -> Result<(), String> {
    tokio::task::spawn_blocking(move || save_tokens(&tokens))
        .await
        .map_err(|error| format!("Could not store sign-in data securely: {error}"))?
}

async fn clear_tokens_async() -> Result<(), String> {
    tokio::task::spawn_blocking(clear_tokens)
        .await
        .map_err(|error| format!("Could not clear secure sign-in storage: {error}"))?
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn random_string(length: usize) -> String {
    rand::rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(refresh: Option<&str>, refresh_in: Option<u64>) -> TokenResponse {
        TokenResponse {
            access_token: "access".to_owned(),
            refresh_token: refresh.map(str::to_owned),
            expires_in: Some(1200),
            refresh_token_expires_in: refresh_in,
            refresh_expires_in: None,
        }
    }

    #[test]
    fn login_records_the_refresh_lifetime_when_published() {
        let tokens = tokens_from_login(response(Some("r1"), Some(86_400)), "client", 1_000);
        assert_eq!(tokens.signed_in_at, Some(1_000));
        assert_eq!(tokens.expires_at, 2_200);
        assert_eq!(tokens.refresh_issued_at, Some(1_000));
        assert_eq!(tokens.refresh_expires_at, Some(87_400));
    }

    #[test]
    fn refresh_expiry_stays_unknown_when_not_published() {
        let tokens = tokens_from_login(response(Some("r1"), None), "client", 1_000);
        assert_eq!(tokens.refresh_expires_at, None);
    }

    #[test]
    fn alternative_field_name_is_read() {
        let parsed: TokenResponse = serde_json::from_str(
            r#"{"access_token":"a","refresh_token":"r","expires_in":60,"refresh_expires_in":500}"#,
        )
        .unwrap();
        assert_eq!(parsed.refresh_lifetime(), Some(500));
    }

    #[test]
    fn renewing_without_a_new_refresh_token_keeps_its_dates() {
        let mut tokens = tokens_from_login(response(Some("r1"), Some(1_000)), "client", 100);
        apply_token_response(&mut tokens, response(None, None), 500);
        assert_eq!(tokens.refresh_token, "r1");
        assert_eq!(tokens.refresh_issued_at, Some(100));
        assert_eq!(tokens.refresh_expires_at, Some(1_100));
        assert_eq!(tokens.expires_at, 1_700);
    }

    #[test]
    fn a_rotated_refresh_token_restarts_its_clock() {
        let mut tokens = tokens_from_login(response(Some("r1"), None), "client", 100);
        apply_token_response(&mut tokens, response(Some("r2"), None), 500);
        assert_eq!(tokens.refresh_token, "r2");
        assert_eq!(tokens.refresh_issued_at, Some(500));
    }

    #[test]
    fn old_stored_tokens_without_the_new_fields_still_load() {
        let tokens: OAuthTokens = serde_json::from_str(
            r#"{"access_token":"a","refresh_token":"r","expires_at":5,"client_id":"c"}"#,
        )
        .unwrap();
        let info = SessionInfo::from_tokens(Some(&tokens));
        assert!(info.signed_in);
        assert_eq!(info.signed_in_at, None);
        assert_eq!(info.access_expires_at, Some(5));
    }

    #[test]
    fn a_sign_in_without_a_recorded_time_gets_the_first_seen_time() {
        let mut tokens: OAuthTokens = serde_json::from_str(
            r#"{"access_token":"a","refresh_token":"r","expires_at":5,"client_id":"c"}"#,
        )
        .unwrap();
        assert!(backfill_signed_in_at(&mut tokens, 700));
        assert_eq!(
            SessionInfo::from_tokens(Some(&tokens)).signed_in_at,
            Some(700)
        );
        // A recorded time is never overwritten.
        assert!(!backfill_signed_in_at(&mut tokens, 900));
        assert_eq!(tokens.signed_in_at, Some(700));
    }

    #[test]
    fn session_info_never_contains_a_token() {
        let tokens = tokens_from_login(response(Some("secret-refresh"), None), "client", 1);
        let json = serde_json::to_string(&SessionInfo::from_tokens(Some(&tokens))).unwrap();
        assert!(!json.contains("secret-refresh"));
        assert!(!json.contains("access\""));
        assert!(json.contains("signedIn"));
        let signed_out = SessionInfo::from_tokens(None);
        assert!(!signed_out.signed_in);
    }

    #[test]
    fn oauth_errors_keep_only_a_bounded_code() {
        assert_eq!(
            sanitize_oauth_error(
                400,
                r#"{"error":"invalid_grant","error_description":"token secret"}"#
            ),
            "OAuth request failed (400): invalid_grant"
        );
        assert_eq!(
            sanitize_oauth_error(500, r#"{"error":"bad code with secrets"}"#),
            "OAuth request failed (500)"
        );
        assert_eq!(
            sanitize_oauth_error(502, "raw response with secret"),
            "OAuth request failed (502)"
        );
    }

    #[test]
    fn only_https_oauth_endpoints_without_credentials_are_accepted() {
        assert!(validate_https_endpoint("https://mcp.scalable.capital/oauth", "test").is_ok());
        assert!(validate_https_endpoint("https://scalable.capital/oauth", "test").is_ok());
        assert!(validate_https_endpoint("https://Auth.Scalable.Capital./oauth", "test").is_ok());
        for endpoint in [
            "http://mcp.scalable.capital/oauth",
            "javascript:alert(1)",
            "https://user:pass@mcp.scalable.capital/oauth",
            "https://",
        ] {
            assert!(
                validate_https_endpoint(endpoint, "test").is_err(),
                "{endpoint}"
            );
        }
    }

    #[test]
    fn oauth_endpoints_outside_the_scalable_domain_are_refused() {
        for endpoint in [
            "https://auth.example/oauth",
            "https://scalable.capital.evil.example/oauth",
            "https://notscalable.capital/oauth",
            "https://scalable.capital@evil.example/oauth",
            "https://127.0.0.1/oauth",
        ] {
            let error = validate_https_endpoint(endpoint, "test").unwrap_err();
            assert!(
                error.contains("scalable.capital") || error.contains("HTTPS"),
                "{endpoint}: {error}"
            );
        }
        assert!(!is_allowed_oauth_host(".scalable.capital"));
    }

    #[test]
    fn callback_request_requires_a_well_formed_http_request_line() {
        let (method, path, error) =
            parse_callback_request("GET /?state=expected&code=abc HTTP/1.1\r\nHost: localhost\r\n");
        assert_eq!(method, "GET");
        assert_eq!(path, "/?state=expected&code=abc");
        assert!(error.is_none());
        assert!(parse_callback_request("POST / HTTP/1.1").2.is_none());
        assert!(parse_callback_request("GET / HTTP/2").2.is_some());
        assert!(parse_callback_request("GET https://elsewhere/ HTTP/1.1")
            .2
            .is_some());
    }

    #[test]
    fn keyring_chunk_count_is_bounded_and_corruption_is_an_error() {
        assert_eq!(read_chunk_count("chunks:2").unwrap(), 2);
        assert!(read_chunk_count("not-a-header").is_err());
        assert!(read_chunk_count("chunks:0").is_err());
        assert!(read_chunk_count("chunks:65").is_err());
    }
}
