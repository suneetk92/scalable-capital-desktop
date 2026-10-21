use super::{
    args::{is_isin, portfolio_arguments},
    client::{require_tool, McpClient},
    response::{extract_records, find_string, strings_at, tool_name},
    session,
    trading::is_trading_tool,
};
use crate::auth;
use serde::Serialize;
use serde_json::{json, Map, Value};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardResponse {
    pub authenticated: bool,
    pub portfolios: Vec<PortfolioSnapshot>,
    pub watchlist: Value,
    /// Set when the watchlist could not be loaded; the list is then empty, not really empty.
    pub watchlist_error: Option<String>,
    pub quotes: Value,
    pub groups: Value,
    pub tools: Vec<String>,
    pub tool_defs: Vec<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSnapshot {
    pub portfolio_id: String,
    pub name: String,
    pub portfolio: Value,
    pub holdings: Value,
    pub overview: Option<Value>,
    pub overview_error: Option<String>,
    pub cash: Option<Value>,
    pub cash_error: Option<String>,
}

impl DashboardResponse {
    fn signed_out() -> Self {
        Self {
            authenticated: false,
            portfolios: Vec::new(),
            watchlist: Value::Array(Vec::new()),
            watchlist_error: None,
            quotes: Value::Object(Map::new()),
            groups: Value::Object(Map::new()),
            tools: Vec::new(),
            tool_defs: Vec::new(),
        }
    }
}

#[tauri::command]
pub async fn load_dashboard(app: tauri::AppHandle) -> Result<DashboardResponse, String> {
    if auth::current_access_token(&app).await?.is_none() {
        return Ok(DashboardResponse::signed_out());
    }
    // A load is a refresh: it starts a new session, which the other commands then share.
    let (mcp, tools) = session::connect_fresh(&app).await?;
    match build_dashboard(mcp, tools).await {
        Err(error) if session::is_stale_session_error(&error) => {
            let (mcp, tools) = session::connect_fresh(&app).await?;
            build_dashboard(mcp, tools).await
        }
        other => other,
    }
}

/// Just the groups, read again after a change to them, so the rest of the dashboard stays as it is.
#[tauri::command]
pub async fn reload_groups(
    app: tauri::AppHandle,
    portfolio_ids: Vec<String>,
) -> Result<Value, String> {
    session::with_session(&app, |mut mcp, tools| {
        let portfolio_ids = portfolio_ids.clone();
        async move { Ok(fetch_groups(&mut mcp, &tools, &portfolio_ids).await) }
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchlistResponse {
    pub watchlist: Value,
    pub watchlist_error: Option<String>,
    pub quotes: Value,
}

/// Just the watchlist and the quotes of the securities in it, read again after adding to it.
/// `known` are the securities whose quotes the page already has; only the others are asked for.
#[tauri::command]
pub async fn reload_watchlist(
    app: tauri::AppHandle,
    known: Vec<String>,
) -> Result<WatchlistResponse, String> {
    session::with_session(&app, |mut mcp, tools| {
        let known = known.clone();
        async move {
            require_tool(&tools, "list_watchlist_items")?;
            let (watchlist, watchlist_error) =
                match mcp.call_tool("list_watchlist_items", json!({})).await {
                    Ok(items) => (items, None),
                    Err(error) if session::is_stale_session_error(&error) => return Err(error),
                    Err(error) => (Value::Array(Vec::new()), Some(error)),
                };
            let mut isins = Vec::new();
            collect_isins(&watchlist, &mut isins);
            isins.retain(|isin| !known.contains(isin));
            let quotes = fetch_quotes(&mut mcp, &tools, &isins).await;
            Ok(WatchlistResponse {
                watchlist,
                watchlist_error,
                quotes,
            })
        }
    })
    .await
}

async fn build_dashboard(
    mut mcp: McpClient,
    tools: Vec<Value>,
) -> Result<DashboardResponse, String> {
    require_tool(&tools, "list_accessible_portfolios")?;
    let portfolio_data = mcp
        .call_tool("list_accessible_portfolios", json!({}))
        .await?;
    let portfolio_records = extract_records(
        &portfolio_data,
        &[
            "portfolios",
            "accessiblePortfolios",
            "items",
            "results",
            "data",
        ],
    );
    let mut portfolios = Vec::new();
    for portfolio in portfolio_records {
        let Some(portfolio_id) = find_string(&portfolio, &["portfolio_id", "portfolioId", "id"])
        else {
            continue;
        };
        let name = find_string(
            &portfolio,
            &[
                "portfolio_name",
                "portfolioName",
                "name",
                "displayName",
                "label",
            ],
        )
        .unwrap_or_else(|| "Portfolio".to_owned());
        let holdings_tool = require_tool(&tools, "get_portfolio_holdings")?;
        let arguments = portfolio_arguments(holdings_tool, &portfolio_id);
        let holdings = mcp
            .call_tool("get_portfolio_holdings", arguments.clone())
            .await?;
        // The overview and cash figures are optional: a failure is reported next to the
        // portfolio instead of failing the whole dashboard or showing made-up zeros.
        let (overview, overview_error) =
            optional_portfolio_call(&mut mcp, &tools, "get_portfolio_overview", &portfolio_id)
                .await;
        let (cash, cash_error) = optional_portfolio_call(
            &mut mcp,
            &tools,
            "get_portfolio_cash_breakdown",
            &portfolio_id,
        )
        .await;
        portfolios.push(PortfolioSnapshot {
            portfolio_id,
            name,
            portfolio,
            holdings,
            overview,
            overview_error,
            cash,
            cash_error,
        });
    }
    let (watchlist, watchlist_error) = if tools
        .iter()
        .any(|tool| tool_name(tool) == Some("list_watchlist_items"))
    {
        match mcp.call_tool("list_watchlist_items", json!({})).await {
            Ok(items) => (items, None),
            Err(error) => (Value::Array(Vec::new()), Some(error)),
        }
    } else {
        (Value::Array(Vec::new()), None)
    };

    let mut isins = Vec::new();
    for portfolio in &portfolios {
        collect_isins(&portfolio.holdings, &mut isins);
    }
    collect_isins(&watchlist, &mut isins);
    let quotes = fetch_quotes(&mut mcp, &tools, &isins).await;
    let portfolio_ids: Vec<String> = portfolios
        .iter()
        .map(|portfolio| portfolio.portfolio_id.clone())
        .collect();
    let groups = fetch_groups(&mut mcp, &tools, &portfolio_ids).await;
    let tool_names = tools
        .iter()
        .filter_map(|tool| tool_name(tool).map(str::to_owned))
        .collect();
    let tool_defs = tools.iter().map(slim_tool).collect();

    Ok(DashboardResponse {
        authenticated: true,
        portfolios,
        watchlist,
        watchlist_error,
        quotes,
        groups,
        tools: tool_names,
        tool_defs,
    })
}

/// Calls a portfolio tool the dashboard can live without. Returns the result, or the reason it
/// failed; both are `None` when Scalable does not offer the tool.
async fn optional_portfolio_call(
    mcp: &mut McpClient,
    tools: &[Value],
    name: &str,
    portfolio_id: &str,
) -> (Option<Value>, Option<String>) {
    let Ok(tool) = require_tool(tools, name) else {
        return (None, None);
    };
    match mcp
        .call_tool(name, portfolio_arguments(tool, portfolio_id))
        .await
    {
        Ok(value) => (Some(value), None),
        Err(error) => (None, Some(error)),
    }
}

/// The complete tool list as Scalable publishes it (`tools/list`): title, description, input and
/// output schemas and annotations. It reads from a new session, so the schemas shown are current.
/// Nothing is called on the account.
#[tauri::command]
pub async fn load_tool_schemas(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let (_client, tools) = session::connect_fresh(&app).await?;
    Ok(tools.iter().map(published_tool).collect())
}

/// The published fields of a tool, without whatever else the server adds to the entry.
fn published_tool(tool: &Value) -> Value {
    let mut entry = Map::new();
    for key in [
        "name",
        "title",
        "description",
        "inputSchema",
        "outputSchema",
        "annotations",
    ] {
        if let Some(value) = tool.get(key) {
            entry.insert(key.to_owned(), value.clone());
        }
    }
    Value::Object(entry)
}

/// Keeps only what the UI needs to describe a tool and build a form for it.
fn slim_tool(tool: &Value) -> Value {
    json!({
        "name": tool.get("name").cloned().unwrap_or(Value::Null),
        "description": tool.get("description").cloned().unwrap_or(Value::Null),
        "inputSchema": tool.get("inputSchema").cloned().unwrap_or(Value::Null),
    })
}

const QUOTE_CONCURRENCY: usize = 16;

/// Whether `fetch_groups` may call this tool on its own on every dashboard load. Only tools that
/// read (`get_*`, `list_*`) and mention a group qualify; trading tools and anything with a
/// write verb in its name never do, whatever Scalable adds later.
fn is_auto_readable_group_tool(name: &str) -> bool {
    const WRITE_VERBS: [&str; 12] = [
        "create", "update", "delete", "assign", "unassign", "add", "remove", "upsert", "set",
        "rename", "submit", "cancel",
    ];
    let lower = name.trim().to_ascii_lowercase();
    (lower.starts_with("get_") || lower.starts_with("list_"))
        && lower.contains("group")
        && !is_trading_tool(&lower)
        && !lower.split('_').any(|part| WRITE_VERBS.contains(&part))
}

/// Scalable's portfolio group tools are not documented, so any read-only tool
/// with "group" in its name (`get_*` or `list_*`, see `is_auto_readable_group_tool`)
/// is called when it needs no arguments other than a portfolio id. Results are
/// keyed by tool name; failed calls are kept as `<tool>:error` so the UI can
/// show why no groups were found.
async fn fetch_groups(mcp: &mut McpClient, tools: &[Value], portfolio_ids: &[String]) -> Value {
    let mut groups = Map::new();
    for tool in tools {
        let Some(name) = tool_name(tool) else {
            continue;
        };
        if !is_auto_readable_group_tool(name) {
            continue;
        }
        let required = strings_at(tool, "/inputSchema/required");
        let has_portfolio_property = tool
            .pointer("/inputSchema/properties")
            .and_then(Value::as_object)
            .is_some_and(|properties| {
                properties
                    .keys()
                    .any(|key| key.to_ascii_lowercase().contains("portfolio"))
            });
        if !required
            .iter()
            .all(|key| key.to_ascii_lowercase().contains("portfolio"))
        {
            // Needs a group id or similar; the UI calls it on demand.
        } else if required.is_empty() && !has_portfolio_property {
            match mcp.call_tool(name, json!({})).await {
                Ok(result) => {
                    groups.insert(name.to_owned(), result);
                }
                Err(error) => {
                    groups.insert(format!("{name}:error"), json!(error));
                }
            }
        } else {
            for portfolio_id in portfolio_ids {
                let arguments = portfolio_arguments(tool, portfolio_id);
                match mcp.call_tool(name, arguments).await {
                    Ok(result) => {
                        groups.insert(format!("{name}:{portfolio_id}"), result);
                    }
                    Err(error) => {
                        groups.insert(format!("{name}:{portfolio_id}:error"), json!(error));
                    }
                }
            }
        }
    }
    Value::Object(groups)
}

fn collect_isins(value: &Value, found: &mut Vec<String>) {
    match value {
        Value::Array(items) => items.iter().for_each(|item| collect_isins(item, found)),
        Value::Object(object) => {
            for (key, child) in object {
                // Crypto coins have no ISIN-based quote; skip the (long) list of supported coins.
                if key.eq_ignore_ascii_case("cryptoHoldings") {
                    continue;
                }
                if key.eq_ignore_ascii_case("isin") {
                    if let Some(text) = child.as_str() {
                        if is_isin(text) && !found.iter().any(|known| known == text) {
                            found.push(text.to_owned());
                        }
                        continue;
                    }
                }
                collect_isins(child, found);
            }
        }
        _ => {}
    }
}

async fn fetch_quotes(mcp: &mut McpClient, tools: &[Value], isins: &[String]) -> Value {
    let mut quotes = Map::new();
    let Ok(tool) = require_tool(tools, "get_security_quote") else {
        return Value::Object(quotes);
    };
    let property = tool
        .pointer("/inputSchema/properties")
        .and_then(Value::as_object)
        .and_then(|properties| {
            properties
                .keys()
                .find(|key| key.to_ascii_lowercase().contains("isin"))
                .cloned()
        })
        .unwrap_or_else(|| "isin".to_owned());
    let mut pending = isins.iter().cloned();
    let mut tasks = tokio::task::JoinSet::new();
    loop {
        while tasks.len() < QUOTE_CONCURRENCY {
            let Some(isin) = pending.next() else { break };
            let mut client = mcp.clone();
            let mut arguments = Map::new();
            arguments.insert(property.clone(), json!(isin));
            tasks.spawn(async move {
                let quote = client
                    .call_tool("get_security_quote", Value::Object(arguments))
                    .await;
                (isin, quote)
            });
        }
        match tasks.join_next().await {
            Some(Ok((isin, Ok(quote)))) => {
                quotes.insert(isin, quote);
            }
            Some(_) => {}
            None => break,
        }
    }
    Value::Object(quotes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn published_tool_keeps_the_schemas_and_drops_other_fields() {
        let tool = json!({
            "name": "ping", "title": "Ping", "inputSchema": { "type": "object" },
            "outputSchema": { "type": "object" }, "annotations": { "readOnlyHint": true },
            "execution": { "taskSupport": "forbidden" }
        });
        let entry = published_tool(&tool);
        assert_eq!(entry["outputSchema"], json!({ "type": "object" }));
        assert_eq!(entry["annotations"]["readOnlyHint"], json!(true));
        assert!(entry.get("execution").is_none());
        assert!(entry.get("description").is_none());
    }

    #[test]
    fn auto_called_group_tools_are_read_only() {
        assert!(is_auto_readable_group_tool("list_portfolio_groups"));
        assert!(is_auto_readable_group_tool("get_portfolio_group"));
        for name in [
            "create_portfolio_group",
            "upsert_portfolio_group",
            "remove_portfolio_group_holdings",
            "add_portfolio_group_holdings",
            "cancel_group_orders",
            "submit_group_order",
            "get_group_cancel_order",
            "portfolio_group",
            "list_portfolios",
        ] {
            assert!(
                !is_auto_readable_group_tool(name),
                "{name} must not be auto-called"
            );
        }
    }

    #[test]
    fn collects_unique_isins_from_nested_records() {
        let value = json!({ "items": [
            { "security": { "isin": "US0378331005" } },
            { "isin": "US0378331005" },
            { "isin": "IE00B4L5Y983" },
            { "isin": "bad" }
        ] });
        let mut found = Vec::new();
        collect_isins(&value, &mut found);
        assert_eq!(found, vec!["US0378331005", "IE00B4L5Y983"]);
    }
}
