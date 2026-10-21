use super::{response::tool_name, trading::is_read_tool};
use crate::auth::MCP_ENDPOINT;
use crate::logging;
use serde_json::{json, Value};
use std::time::Duration;

/// How often a request throttled with 429 is sent again, and the longest wait between tries.
const THROTTLE_RETRIES: u32 = 2;
const THROTTLE_MAX_WAIT: Duration = Duration::from_secs(5);
const TRANSIENT_RETRIES: u32 = 2;
const MCP_HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ERROR_BODY_CHARS: usize = 1_000;

#[derive(Clone)]
pub struct McpClient {
    http: reqwest::Client,
    access_token: String,
    session_id: Option<String>,
    protocol_version: String,
    next_request_id: u64,
}

impl McpClient {
    pub fn new(access_token: String) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(MCP_HTTP_TIMEOUT)
                .build()
                .unwrap_or_default(),
            access_token,
            session_id: None,
            protocol_version: "2025-03-26".to_owned(),
            next_request_id: 1,
        }
    }

    pub async fn initialize(&mut self) -> Result<(), String> {
        let request_id = self.next_id();
        let response = self
            .rpc(json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "initialize",
                "params": {
                    "protocolVersion": self.protocol_version,
                    "capabilities": {},
                    "clientInfo": { "name": "scalable-capital-desktop", "version": env!("CARGO_PKG_VERSION") }
                }
            }))
            .await?;
        if let Some(version) = response
            .pointer("/result/protocolVersion")
            .and_then(Value::as_str)
        {
            self.protocol_version = version.to_owned();
        }
        self.rpc(json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }))
        .await?;
        Ok(())
    }

    fn next_id(&mut self) -> u64 {
        let id = self.next_request_id;
        self.next_request_id += 1;
        id
    }

    async fn rpc(&mut self, payload: Value) -> Result<Value, String> {
        let method = payload
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let retryable = retryable_request(&payload);
        let mut throttle_attempt = 0;
        let mut transient_attempt = 0;
        let response = loop {
            let mut request = self
                .http
                .post(MCP_ENDPOINT)
                .bearer_auth(&self.access_token)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .header(
                    reqwest::header::ACCEPT,
                    "application/json, text/event-stream",
                );
            if method != "initialize" {
                request = request.header("MCP-Protocol-Version", self.protocol_version.as_str());
            }
            if let Some(session_id) = &self.session_id {
                request = request.header("MCP-Session-Id", session_id);
            }

            match request.json(&payload).send().await {
                Err(_) if retryable && transient_attempt < TRANSIENT_RETRIES => {
                    transient_attempt += 1;
                    tokio::time::sleep(transient_wait(transient_attempt)).await;
                }
                Err(error) => {
                    return Err(format!("Could not connect to Scalable MCP: {error}"));
                }
                Ok(response)
                    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
                        && retryable
                        && throttle_attempt < THROTTLE_RETRIES =>
                {
                    throttle_attempt += 1;
                    tokio::time::sleep(throttle_wait(response.headers(), throttle_attempt)).await;
                }
                Ok(response)
                    if retryable
                        && is_transient_status(response.status())
                        && transient_attempt < TRANSIENT_RETRIES =>
                {
                    transient_attempt += 1;
                    tokio::time::sleep(transient_wait(transient_attempt)).await;
                }
                Ok(response) => break response,
            }
        };
        if let Some(session_id) = response
            .headers()
            .get("MCP-Session-Id")
            .and_then(|value| value.to_str().ok())
        {
            self.session_id = Some(session_id.to_owned());
        }
        let status = response.status();
        let is_event_stream = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|content_type| content_type.starts_with("text/event-stream"));
        let body = response
            .text()
            .await
            .map_err(|error| format!("Could not read Scalable MCP response: {error}"))?;
        if !status.is_success() {
            return Err(http_error(status, &body));
        }
        if body.trim().is_empty() {
            return Ok(Value::Null);
        }
        let parsed = if is_event_stream {
            parse_event_stream(&body)?
        } else {
            serde_json::from_str(&body)
                .map_err(|error| format!("Invalid Scalable MCP JSON-RPC response: {error}"))?
        };
        if let Some(error) = parsed.get("error") {
            return Err(format!("Scalable MCP request failed: {error}"));
        }
        Ok(parsed)
    }

    pub async fn list_tools(&mut self) -> Result<Vec<Value>, String> {
        let request_id = self.next_id();
        let response = self
            .rpc(json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/list",
                "params": {}
            }))
            .await?;
        Ok(response
            .pointer("/result/tools")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    pub async fn call_tool(&mut self, name: &str, arguments: Value) -> Result<Value, String> {
        let request_id = self.next_id();
        let response = self
            .rpc(json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/call",
                "params": { "name": name, "arguments": arguments }
            }))
            .await?;
        let result = response
            .get("result")
            .ok_or_else(|| format!("Scalable MCP did not return a result for {name}"))?;
        if result.get("isError").and_then(Value::as_bool) == Some(true) {
            return Err(tool_failure(name, &tool_payload(result)));
        }
        Ok(tool_payload(result))
    }
}

fn http_error(status: reqwest::StatusCode, body: &str) -> String {
    let body = logging::clip(&logging::redact(body.trim()), MAX_ERROR_BODY_CHARS);
    format!("Scalable MCP returned {status}: {body}")
}

fn retryable_request(payload: &Value) -> bool {
    match payload.get("method").and_then(Value::as_str) {
        Some("initialize" | "tools/list") => true,
        Some("tools/call") => payload
            .pointer("/params/name")
            .and_then(Value::as_str)
            .is_some_and(is_read_tool),
        _ => false,
    }
}

fn is_transient_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 502..=504)
}

fn transient_wait(attempt: u32) -> Duration {
    Duration::from_secs(1_u64 << attempt.saturating_sub(1).min(1))
}

/// How long to wait after a 429: the `Retry-After` seconds when Scalable sends them, otherwise a
/// growing pause, never longer than `THROTTLE_MAX_WAIT`.
fn throttle_wait(headers: &reqwest::header::HeaderMap, attempt: u32) -> Duration {
    headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map_or(Duration::from_secs(u64::from(attempt)), Duration::from_secs)
        .min(THROTTLE_MAX_WAIT)
}

/// The error text of a failed tool call. Scalable answers with JSON such as
/// `{"error":{"code":"internal_error","message":"The request could not be completed."}}`;
/// the message comes first and the other fields (code, reference ids, details) follow as
/// "Details: error.code=…", redacted and clipped. The raw payload is kept when it has no message or
/// points to an expired session.
fn tool_failure(name: &str, payload: &Value) -> String {
    let raw = format!("Scalable MCP tool {name} failed: {payload}");
    if super::session::is_stale_session_error(&raw) {
        return raw;
    }
    let message = payload
        .pointer("/error/message")
        .or_else(|| payload.get("message"))
        .or_else(|| payload.get("error"))
        .unwrap_or(payload)
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty());
    let details = tool_error_details(payload)
        .map(|details| format!(" Details: {details}"))
        .unwrap_or_default();
    match message {
        Some(text) if text.ends_with(['.', '!', '?']) => {
            format!("Scalable MCP tool {name} failed. {text}{details}")
        }
        Some(text) => format!("Scalable MCP tool {name} failed. {text}.{details}"),
        None => raw,
    }
}

/// Every field of the error payload except the message, as `path=value` pairs.
fn tool_error_details(payload: &Value) -> Option<String> {
    let mut fields = Vec::new();
    if let Some(object) = payload.as_object() {
        for (key, value) in object {
            if key != "message" && !(key == "error" && value.is_string()) {
                append_error_fields(value, key, 0, &mut fields);
            }
        }
    }
    if fields.is_empty() {
        return None;
    }
    Some(logging::clip(
        &logging::redact(&fields.join("; ")),
        MAX_ERROR_BODY_CHARS,
    ))
}

fn append_error_fields(value: &Value, path: &str, depth: usize, fields: &mut Vec<String>) {
    if depth > 3 || fields.len() >= 16 || is_sensitive_error_key(path) {
        return;
    }
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if key != "message" {
                    append_error_fields(child, &format!("{path}.{key}"), depth + 1, fields);
                }
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter().take(8).enumerate() {
                append_error_fields(item, &format!("{path}[{index}]"), depth + 1, fields);
            }
        }
        Value::Null => {}
        Value::String(text) if text.trim().is_empty() => {}
        Value::String(text) => fields.push(format!("{path}={}", text.trim())),
        _ => fields.push(format!("{path}={value}")),
    }
}

fn is_sensitive_error_key(path: &str) -> bool {
    let key = path
        .rsplit(['.', '['])
        .next()
        .unwrap_or(path)
        .to_ascii_lowercase();
    [
        "token",
        "secret",
        "password",
        "authorization",
        "submission",
        "confirm",
    ]
    .iter()
    .any(|word| key.contains(word))
}

pub fn require_tool<'a>(tools: &'a [Value], name: &str) -> Result<&'a Value, String> {
    tools
        .iter()
        .find(|tool| tool_name(tool) == Some(name))
        .ok_or_else(|| format!("Scalable MCP does not advertise the {name} tool"))
}

pub fn tool_payload(result: &Value) -> Value {
    if let Some(structured) = result.get("structuredContent") {
        return structured.clone();
    }
    let Some(content) = result.get("content").and_then(Value::as_array) else {
        return result.clone();
    };
    let values: Vec<Value> = content
        .iter()
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .map(|text| serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_owned())))
        .collect();
    match values.len() {
        0 => Value::Null,
        1 => values.into_iter().next().unwrap_or(Value::Null),
        _ => Value::Array(values),
    }
}

fn parse_event_stream(body: &str) -> Result<Value, String> {
    let mut last_event = None;
    for line in body.lines() {
        if let Some(data) = line.trim().strip_prefix("data:") {
            let data = data.trim();
            if data != "[DONE]" {
                last_event =
                    Some(serde_json::from_str(data).map_err(|error| {
                        format!("Invalid Scalable MCP event-stream JSON: {error}")
                    })?);
            }
        }
    }
    last_event.ok_or_else(|| "Scalable MCP returned an empty event stream".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tool_text_content_as_json() {
        let response = json!({ "content": [{ "type": "text", "text": "{\"items\":[1]}" }] });
        assert_eq!(tool_payload(&response), json!({ "items": [1] }));
    }

    #[test]
    fn tool_failures_include_safe_details_with_the_message() {
        let payload = json!({ "error": { "code": "internal_error", "message": "The request could not be completed." } });
        assert_eq!(
            tool_failure("add_watchlist_item", &payload),
            "Scalable MCP tool add_watchlist_item failed. The request could not be completed. Details: error.code=internal_error"
        );
        let payload = json!({ "error": { "code": "internal_error", "message": "Try again.", "details": { "reason": "venue_unavailable" }, "requestId": "req-123", "access_token": "do-not-show" } });
        let failure = tool_failure("preview_sell_order", &payload);
        assert!(failure.contains("error.code=internal_error"));
        assert!(failure.contains("error.details.reason=venue_unavailable"));
        assert!(failure.contains("error.requestId=req-123"));
        assert!(!failure.contains("do-not-show"));
        assert_eq!(
            tool_failure("x", &json!("not found")),
            "Scalable MCP tool x failed. not found."
        );
        assert_eq!(
            tool_failure("x", &json!({ "code": 7 })),
            "Scalable MCP tool x failed: {\"code\":7}"
        );
        assert!(tool_failure(
            "x",
            &json!({ "error": { "code": "invalid_token", "message": "Expired" } })
        )
        .contains("invalid_token"));
    }

    #[test]
    fn throttle_wait_follows_retry_after_up_to_the_limit() {
        let mut headers = reqwest::header::HeaderMap::new();
        assert_eq!(throttle_wait(&headers, 2), Duration::from_secs(2));
        headers.insert(reqwest::header::RETRY_AFTER, "3".parse().unwrap());
        assert_eq!(throttle_wait(&headers, 1), Duration::from_secs(3));
        headers.insert(reqwest::header::RETRY_AFTER, "120".parse().unwrap());
        assert_eq!(throttle_wait(&headers, 1), THROTTLE_MAX_WAIT);
    }

    #[test]
    fn transient_retry_is_limited_to_session_setup_and_read_tools() {
        for payload in [
            json!({"method":"initialize"}),
            json!({"method":"tools/list"}),
            json!({"method":"tools/call","params":{"name":"get_security_quote"}}),
            json!({"method":"tools/call","params":{"name":"preview_buy_order"}}),
        ] {
            assert!(retryable_request(&payload));
        }
        for payload in [
            json!({"method":"notifications/initialized"}),
            json!({"method":"tools/call","params":{"name":"submit_buy_order"}}),
            json!({"method":"tools/call","params":{"name":"unknown_tool"}}),
        ] {
            assert!(!retryable_request(&payload));
        }
        assert!(is_transient_status(reqwest::StatusCode::BAD_GATEWAY));
        assert!(is_transient_status(
            reqwest::StatusCode::SERVICE_UNAVAILABLE
        ));
        assert!(is_transient_status(reqwest::StatusCode::GATEWAY_TIMEOUT));
        assert!(!is_transient_status(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR
        ));
        assert_eq!(transient_wait(1), Duration::from_secs(1));
        assert_eq!(transient_wait(2), Duration::from_secs(2));
    }

    #[test]
    fn parses_event_stream_json_rpc_payload() {
        let response =
            parse_event_stream("event: message\ndata: {\"jsonrpc\":\"2.0\",\"result\":{}}\n\n")
                .unwrap();
        assert_eq!(response["result"], json!({}));
    }

    #[test]
    fn http_error_body_is_redacted_and_clipped_without_changing_the_prefix() {
        let error = http_error(
            reqwest::StatusCode::BAD_GATEWAY,
            r#"Authorization: Bearer account-token access_token="refresh-secret""#,
        );
        assert!(error.starts_with("Scalable MCP returned 502"));
        assert!(!error.contains("account-token"));
        assert!(!error.contains("refresh-secret"));
        assert!(error.contains("[redacted]"));

        let long = http_error(reqwest::StatusCode::BAD_GATEWAY, &"x".repeat(1_100));
        let body = long.split_once(": ").unwrap().1;
        assert_eq!(body.chars().count(), MAX_ERROR_BODY_CHARS);
        assert!(body.ends_with('…'));
    }
}
