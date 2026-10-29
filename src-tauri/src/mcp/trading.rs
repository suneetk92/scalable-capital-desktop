use super::{
    args::{is_isin, validate_arguments},
    client::{require_tool, McpClient},
    hours::exchange_open,
    response::strings_at,
    savings::SavingsState,
    session,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, State};

/// Order and savings-plan submission have their own preview-then-confirm flows, so they are never
/// reachable through the generic tool runner.
const BLOCKED_GENERIC_TOOLS: [&str; 3] = [
    "submit_buy_order",
    "submit_sell_order",
    "submit_savings_plan",
];

pub(crate) const TRADING_OFF: &str =
    "Trading is switched off. Switch to Full access (top right) while the exchange is open to place orders or change savings plans.";

pub(crate) const MANAGE_OFF: &str =
    "The app is in Read-only mode. Switch to Restricted or Full access (top right) to change watchlists, price alerts and portfolio groups.";

/// How much the user has allowed: nothing but reading, watchlists, price alerts and portfolio
/// groups (Scalable's "Limited access"), or everything including orders and savings plans.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccessMode {
    Readonly,
    Restricted,
    Full,
}

/// Whether the user has switched Trading on. Starts off on every launch; the UI sends its saved
/// choice when it loads, so a reload or a missed message can only ever fail closed. Outside the
/// exchange hours (`hours.rs`) Trading counts as off whatever the switch says.
#[derive(Default, Clone)]
pub struct TradingGate {
    /// Full access: orders and savings plans, only while the exchange is open.
    pub(super) enabled: Arc<AtomicBool>,
    /// Restricted access: watchlists, price alerts and portfolio groups, at any hour.
    pub(super) manage: Arc<AtomicBool>,
}

impl TradingGate {
    pub(crate) fn is_on(&self) -> bool {
        self.enabled.load(Ordering::SeqCst) && exchange_open()
    }

    /// Whether tools that manage watchlists, price alerts and portfolio groups may run. Full access includes it.
    pub(crate) fn manage_on(&self) -> bool {
        self.manage.load(Ordering::SeqCst) || self.enabled.load(Ordering::SeqCst)
    }

    #[cfg(test)]
    pub(crate) fn set_for_test(&self, on: bool) {
        self.enabled.store(on, Ordering::SeqCst);
    }
}

/// Tools that may run without enabling Trading. Keep in sync with `isReadTool` in `src/tools.ts`; both tests read `tests/fixtures/tool-policy.json`.
pub(super) fn is_read_tool(name: &str) -> bool {
    let name = name.trim().to_ascii_lowercase();
    name == "ping"
        || ["get_", "list_", "search_", "preview_"]
            .iter()
            .any(|prefix| name.starts_with(prefix))
}

/// Tools of Scalable's "Limited access" level: they change watchlists, price alerts and portfolio groups, never money.
/// An exact list, so a new tool that merely mentions a watchlist or group still needs Full access. Keep in sync
/// with `isManageTool` in `src/tools.ts`; `tools.test.ts` reads this declaration, so keep its shape.
const MANAGE_TOOLS: [&str; 9] = [
    "add_watchlist_item",
    "remove_watchlist_item",
    "create_price_alert",
    "remove_price_alert",
    "create_portfolio_group",
    "upsert_portfolio_group",
    "remove_portfolio_group",
    "add_portfolio_group_holdings",
    "remove_portfolio_group_holdings",
];

pub(super) fn is_manage_tool(name: &str) -> bool {
    let name = name.trim().to_ascii_lowercase();
    MANAGE_TOOLS.contains(&name.as_str())
}

/// The Trading gate is fail-closed: every unknown or non-read tool needs Full access, except the manage tools, which need Restricted access.
pub(super) fn is_trading_tool(name: &str) -> bool {
    !is_read_tool(name) && !is_manage_tool(name)
}

/// The error to return when `name` may not run right now, or `None` when it may.
fn trading_block(gate: &TradingGate, name: &str) -> Option<&'static str> {
    if is_manage_tool(name) {
        return (!gate.manage_on()).then_some(MANAGE_OFF);
    }
    (is_trading_tool(name) && !gate.is_on()).then_some(TRADING_OFF)
}

/// Like `trading_block` for the backend's own calls, which also treat a preview as Trading.
pub(super) fn call_block(gate: &TradingGate, name: &str) -> Option<&'static str> {
    if name.trim().to_ascii_lowercase().starts_with("preview_") {
        return (!gate.is_on()).then_some(TRADING_OFF);
    }
    trading_block(gate, name)
}

/// Why the generic runner refuses `name` before anything is sent, or `None` when it may run.
fn generic_refusal(gate: &TradingGate, name: &str) -> Option<String> {
    if let Some(reason) = trading_block(gate, name) {
        return Some(reason.to_owned());
    }
    BLOCKED_GENERIC_TOOLS.contains(&name).then(|| {
        "Orders and savings plans are submitted from their own dialogs, which preview and confirm them first."
            .to_owned()
    })
}

/// Sets the Trading switch. Switching off also drops all pending order and savings-plan previews.
/// Used by the switch command and by sign-out.
pub fn switch_trading(gate: &TradingGate, state: &TradeState, plans: &SavingsState, enabled: bool) {
    switch_access(
        gate,
        state,
        plans,
        if enabled {
            AccessMode::Full
        } else {
            AccessMode::Readonly
        },
    );
}

/// Sets the access mode. Leaving Full access drops all pending order and savings-plan previews.
pub fn switch_access(
    gate: &TradingGate,
    state: &TradeState,
    plans: &SavingsState,
    mode: AccessMode,
) {
    gate.enabled
        .store(mode == AccessMode::Full, Ordering::SeqCst);
    gate.manage
        .store(mode != AccessMode::Readonly, Ordering::SeqCst);
    if mode != AccessMode::Full {
        state.clear_pending();
        plans.clear_pending();
    }
}

/// Called by the UI on load and whenever the Trading switch changes. Not async, so calls are
/// handled in the order they were sent.
#[tauri::command]
pub fn set_access_mode(
    gate: State<'_, TradingGate>,
    state: State<'_, TradeState>,
    plans: State<'_, SavingsState>,
    mode: AccessMode,
) {
    switch_access(&gate, &state, &plans, mode);
}

#[derive(Deserialize)]
pub struct ToolCall {
    pub name: String,
    #[serde(default)]
    pub arguments: Value,
}

#[derive(Serialize)]
pub struct ToolOutcome {
    pub name: String,
    pub ok: bool,
    pub result: Option<Value>,
    pub error: Option<String>,
}

/// Runs several MCP tool calls over the shared session and returns one outcome per call, in
/// order. A failing call does not fail the others. Calls Scalable rejected because the session
/// or token went stale are repeated once on a new session, but non-read tools are never repeated.
#[tauri::command]
pub async fn call_tools(
    app: AppHandle,
    gate: State<'_, TradingGate>,
    calls: Vec<ToolCall>,
) -> Result<Vec<ToolOutcome>, String> {
    // A batch the gate refuses as a whole needs no session: the answer is the same signed in or out.
    let refused: Vec<Option<String>> = calls
        .iter()
        .map(|call| generic_refusal(&gate, &call.name))
        .collect();
    if !calls.is_empty() && refused.iter().all(Option::is_some) {
        return Ok(calls
            .into_iter()
            .zip(refused)
            .map(|(call, reason)| failed(call.name, reason.unwrap_or_default()))
            .collect());
    }
    let (mcp, tools) = session::connect(&app).await?;
    let mut outcomes: Vec<ToolOutcome> = Vec::with_capacity(calls.len());
    let first = run_batch(&mcp, &tools, &gate, &calls).await;
    let mut retry: Vec<usize> = Vec::new();
    for (index, outcome) in first.into_iter().enumerate() {
        let stale = outcome
            .error
            .as_deref()
            .is_some_and(session::is_stale_session_error);
        if stale && is_read_tool(&calls[index].name) {
            retry.push(index);
        }
        outcomes.push(outcome);
    }
    if !retry.is_empty() {
        session::invalidate(&app).await;
        if let Ok((mcp, tools)) = session::connect(&app).await {
            let again: Vec<ToolCall> = retry
                .iter()
                .map(|&index| ToolCall {
                    name: calls[index].name.clone(),
                    arguments: calls[index].arguments.clone(),
                })
                .collect();
            for (index, outcome) in retry
                .into_iter()
                .zip(run_batch(&mcp, &tools, &gate, &again).await)
            {
                outcomes[index] = outcome;
            }
        }
    }
    Ok(outcomes)
}

/// Runs the calls concurrently and returns exactly one outcome per call, in order.
async fn run_batch(
    mcp: &McpClient,
    tools: &[Value],
    gate: &TradingGate,
    calls: &[ToolCall],
) -> Vec<ToolOutcome> {
    let mut outcomes: Vec<Option<ToolOutcome>> = calls.iter().map(|_| None).collect();
    let mut tasks = tokio::task::JoinSet::new();
    for (index, call) in calls.iter().enumerate() {
        let name = call.name.clone();
        // Checked right before the call, so a switch-off during the connection setup still
        // stops the call.
        if let Some(reason) = generic_refusal(gate, &name) {
            outcomes[index] = Some(failed(name, reason));
            continue;
        }
        let arguments = if call.arguments.is_null() {
            json!({})
        } else {
            call.arguments.clone()
        };
        let tool = match require_tool(tools, &name) {
            Ok(tool) => tool,
            Err(_) => {
                let error = format!("Scalable did not offer {name} for this sign-in.");
                outcomes[index] = Some(failed(name, error));
                continue;
            }
        };
        if let Err(error) = validate_arguments(tool, &arguments) {
            outcomes[index] = Some(failed(name, error));
            continue;
        }
        let mut client = mcp.clone();
        let gate = gate.clone();
        tasks.spawn(async move {
            let outcome = if let Some(reason) = trading_block(&gate, &name) {
                Err(reason.to_owned())
            } else {
                client.call_tool(&name, arguments).await
            };
            (index, name, outcome)
        });
    }
    while let Some(joined) = tasks.join_next().await {
        // A panicked task has no index, so its slot stays empty and is filled in below.
        let Ok((index, name, outcome)) = joined else {
            continue;
        };
        outcomes[index] = Some(match outcome {
            Ok(result) => ToolOutcome {
                name,
                ok: true,
                result: Some(result),
                error: None,
            },
            Err(error) => failed(name, error),
        });
    }
    // One outcome per call, in order, even when a task died: dropping the empty slots would
    // shift every later result onto the wrong call.
    outcomes
        .into_iter()
        .zip(calls)
        .map(|(outcome, call)| {
            outcome.unwrap_or_else(|| {
                failed(
                    call.name.clone(),
                    "The call stopped unexpectedly. Check the result in Scalable before trying again."
                        .to_owned(),
                )
            })
        })
        .collect()
}

fn failed(name: String, error: String) -> ToolOutcome {
    ToolOutcome {
        name,
        ok: false,
        result: None,
        error: Some(error),
    }
}

pub(super) const PREVIEW_TTL: Duration = Duration::from_secs(300);
pub(super) const MAX_PENDING_PREVIEWS: usize = 8;

pub(crate) const TRADING_UNAVAILABLE: &str = "Scalable MCP does not offer order tools for this sign-in. In the Scalable app open Profile > Security > Agentic Investing, set the MCP access level to Full access, then sign out here and sign in again.";

pub struct Previews<R> {
    pending: Mutex<Vec<Pending<R>>>,
    next_id: AtomicU64,
}

impl<R> Default for Previews<R> {
    fn default() -> Self {
        Self {
            pending: Mutex::new(Vec::new()),
            next_id: AtomicU64::default(),
        }
    }
}

pub(super) struct Pending<R> {
    id: String,
    pub(super) request: R,
    pub(super) preview: Value,
    pub(super) created: Instant,
}

impl<R> Previews<R> {
    /// Keeps a preview for the confirmation step. The gate is checked while holding the lock,
    /// so a preview whose network call finished after Trading was switched off is dropped
    /// instead of being stored behind the clearing done by `set_access_mode`.
    pub(super) fn store_preview(
        &self,
        gate: &TradingGate,
        request: R,
        preview: Value,
    ) -> Result<String, String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Preview state is unavailable".to_owned())?;
        if !gate.is_on() {
            pending.clear();
            return Err(TRADING_OFF.to_owned());
        }
        pending.retain(|item| item.created.elapsed() <= PREVIEW_TTL);
        if pending.len() >= MAX_PENDING_PREVIEWS {
            pending.remove(0);
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        pending.push(Pending {
            id: id.clone(),
            request,
            preview,
            created: Instant::now(),
        });
        Ok(id)
    }

    pub(super) fn take(&self, id: &str) -> Result<Pending<R>, String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Preview state is unavailable".to_owned())?;
        let index = pending
            .iter()
            .position(|item| item.id == id)
            .ok_or_else(|| "Preview is no longer available. Preview it again.".to_owned())?;
        Ok(pending.remove(index))
    }

    pub(super) fn clear_pending(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }

    #[cfg(test)]
    pub(super) fn pending_count(&self) -> usize {
        self.pending
            .lock()
            .map(|pending| pending.len())
            .unwrap_or(0)
    }
}

pub type TradeState = Previews<OrderRequest>;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrderRequest {
    pub side: String,
    pub isin: String,
    #[serde(default)]
    pub portfolio_id: Option<String>,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub shares: Option<f64>,
    pub order_type: String,
    #[serde(default)]
    pub limit_price: Option<f64>,
    #[serde(default)]
    pub stop_price: Option<f64>,
    /// The trading venue (`gettex`, `xetra`, ...); `None` leaves it to the account's default venue,
    /// which Scalable refuses for securities that venue does not list.
    #[serde(default)]
    pub venue: Option<String>,
}

fn positive(value: Option<f64>) -> bool {
    value.is_some_and(|number| number.is_finite() && number > 0.0)
}

impl OrderRequest {
    fn validate(&self) -> Result<(), String> {
        if self.side != "buy" && self.side != "sell" {
            return Err("The order side must be buy or sell".to_owned());
        }
        if !is_isin(&self.isin) {
            return Err("A valid 12-character ISIN is required".to_owned());
        }
        if !matches!(self.order_type.as_str(), "market" | "limit" | "stop") {
            return Err("The order type must be market, limit or stop".to_owned());
        }
        if self.amount.is_some() == self.shares.is_some() {
            return Err("Enter either an amount or a number of shares, not both".to_owned());
        }
        if self.amount.is_some() && !positive(self.amount)
            || self.shares.is_some() && !positive(self.shares)
        {
            return Err("The order size must be greater than zero".to_owned());
        }
        if self.side == "buy" && self.shares.is_some_and(|shares| shares.fract() != 0.0) {
            return Err("Buy orders accept whole shares only".to_owned());
        }
        if self.order_type == "limit" && !positive(self.limit_price) {
            return Err("A limit order needs a limit price".to_owned());
        }
        if self.order_type == "stop" && !positive(self.stop_price) {
            return Err("A stop order needs a stop price".to_owned());
        }
        // The live input schema holds the allowed venues; this only keeps the value a plain name.
        if self.venue.as_deref().is_some_and(|venue| {
            venue.is_empty()
                || venue.len() > 32
                || !venue
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        }) {
            return Err("The trading venue is not valid".to_owned());
        }
        Ok(())
    }
}

/// A whole number is sent as an integer, because a buy order's `shares` must be one.
pub(super) fn number(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9.0e15 {
        json!(value as i64)
    } else {
        json!(value)
    }
}

/// The arguments of `preview_buy_order` and `preview_sell_order`, in the shape their input schemas
/// publish: `isin`, `portfolioId`, `venue`, `quantity: { mode, amount | shares }` and `order: { type, ... }`.
pub(crate) fn preview_arguments(request: &OrderRequest) -> Value {
    let mut arguments = Map::new();
    arguments.insert("isin".to_owned(), json!(request.isin));
    if let Some(portfolio_id) = request.portfolio_id.as_deref().filter(|id| !id.is_empty()) {
        arguments.insert("portfolioId".to_owned(), json!(portfolio_id));
    }
    if let Some(venue) = request.venue.as_deref() {
        arguments.insert("venue".to_owned(), json!(venue));
    }
    let quantity = match (request.amount, request.shares) {
        (Some(amount), _) => json!({ "mode": "amount", "amount": number(amount) }),
        (None, shares) => json!({ "mode": "shares", "shares": number(shares.unwrap_or_default()) }),
    };
    arguments.insert("quantity".to_owned(), quantity);
    let mut order = Map::new();
    order.insert("type".to_owned(), json!(request.order_type));
    if let Some(price) = request
        .limit_price
        .filter(|_| request.order_type == "limit")
    {
        order.insert("limitPrice".to_owned(), number(price));
    }
    if let Some(price) = request.stop_price.filter(|_| request.order_type == "stop") {
        order.insert("stopPrice".to_owned(), number(price));
    }
    arguments.insert("order".to_owned(), Value::Object(order));
    Value::Object(arguments)
}

/// The `submission` object of an order or savings-plan preview. It is passed to the submit tool unchanged.
pub(crate) fn submission_of(preview: &Value) -> Result<&Value, String> {
    preview
        .get("submission")
        .filter(|submission| submission.is_object())
        .ok_or_else(|| {
            "Scalable did not return anything to confirm. Nothing was placed or changed.".to_owned()
        })
}

/// The acknowledgement ids the preview asks the user to accept before the order can be submitted.
pub(crate) fn required_acknowledgements(submission: &Value) -> Vec<String> {
    strings_at(
        submission,
        "/confirmationContext/requiredAcknowledgementIds",
    )
}

/// The arguments of `submit_buy_order` and `submit_sell_order`: the preview's `submission` and the
/// acknowledgement ids the user accepted.
pub(crate) fn submit_arguments(submission: &Value, acknowledgement_ids: &[String]) -> Value {
    json!({ "submission": submission, "acknowledgementIds": acknowledgement_ids })
}

#[tauri::command]
pub async fn search_securities(app: AppHandle, query: String) -> Result<Value, String> {
    let query = query.trim().to_owned();
    if query.chars().count() < 2 {
        return Ok(Value::Array(Vec::new()));
    }
    session::call_tool(
        &app,
        "search_securities",
        json!({ "query": query }),
        session::Retry::ReadOnly,
        "Scalable MCP does not offer the search_securities tool for this sign-in.",
    )
    .await
}

#[tauri::command]
pub async fn preview_order(
    app: AppHandle,
    gate: State<'_, TradingGate>,
    state: State<'_, TradeState>,
    request: OrderRequest,
) -> Result<Value, String> {
    request.validate()?;
    if !gate.is_on() {
        return Err(TRADING_OFF.to_owned());
    }
    let tool_name = format!("preview_{}_order", request.side);
    // A preview changes nothing at Scalable, so it may be repeated on a new session.
    let preview = session::call_tool(
        &app,
        &tool_name,
        preview_arguments(&request),
        session::Retry::ReadOnly,
        TRADING_UNAVAILABLE,
    )
    .await?;
    submission_of(&preview)?;
    let preview_id = state.store_preview(&gate, request, preview.clone())?;
    Ok(json!({ "previewId": preview_id, "preview": preview }))
}

#[tauri::command]
pub async fn submit_order(
    app: AppHandle,
    gate: State<'_, TradingGate>,
    state: State<'_, TradeState>,
    preview_id: String,
    request: OrderRequest,
    acknowledge_warning: bool,
) -> Result<Value, String> {
    let (tool_name, arguments) =
        take_submission(&gate, &state, &preview_id, &request, acknowledge_warning)?;
    session::call_tool(
        &app,
        &tool_name,
        arguments,
        session::Retry::Never,
        TRADING_UNAVAILABLE,
    )
    .await
    .map_err(|error| {
        format!("{error}. If you are not sure whether the order went through, check your transactions in Scalable before trying again.")
    })
}

/// Everything `submit_order` checks before it sends anything: the gate, the one-time preview, that
/// the order is unchanged and fresh, and the accepted warning. Returns the submit tool and its
/// arguments. The preview is removed before anything is sent, so a failed or uncertain submission
/// can never be retried automatically.
fn take_submission(
    gate: &TradingGate,
    state: &TradeState,
    preview_id: &str,
    request: &OrderRequest,
    acknowledge_warning: bool,
) -> Result<(String, Value), String> {
    request.validate()?;
    if !gate.is_on() {
        return Err(format!("{TRADING_OFF} Nothing was placed."));
    }
    let pending = state.take(preview_id).map_err(|error| {
        if error.starts_with("Preview is no longer available") {
            "Preview the order first. Nothing was placed.".to_owned()
        } else {
            error
        }
    })?;
    if pending.request != *request {
        return Err(
            "The order changed after the preview. Preview it again. Nothing was placed.".to_owned(),
        );
    }
    if pending.created.elapsed() > PREVIEW_TTL {
        return Err("The preview expired. Preview the order again. Nothing was placed.".to_owned());
    }
    let tool_name = format!("submit_{}_order", request.side);
    let submission = submission_of(&pending.preview)?;
    let required = required_acknowledgements(submission);
    if !required.is_empty() && !acknowledge_warning {
        return Err("Accept the warning in the preview first. Nothing was placed.".to_owned());
    }
    let accepted = if acknowledge_warning {
        required
    } else {
        Vec::new()
    };
    Ok((tool_name, submit_arguments(submission, &accepted)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tool names under one key of the shared policy fixture.
    fn policy_names(key: &str) -> Vec<String> {
        let policy: Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/tool-policy.json"))
                .expect("tests/fixtures/tool-policy.json is valid");
        policy[key]
            .as_array()
            .expect("a list of names")
            .iter()
            .map(|name| name.as_str().expect("a name").to_owned())
            .collect()
    }

    /// The tools that need Full access.
    fn write_tools() -> Vec<String> {
        policy_names("trading")
    }

    fn calls_for(names: &[String]) -> Vec<ToolCall> {
        names
            .iter()
            .map(|name| ToolCall {
                name: name.clone(),
                arguments: json!({}),
            })
            .collect()
    }

    /// The generic runner with Trading off: every write tool is refused before any session or
    /// network is touched; switched on, the same calls reach the dispatch (and fail here only
    /// because the empty tool list does not offer them). Reads pass either way.
    #[tokio::test]
    async fn generic_runner_refuses_every_write_tool_until_trading_is_on() {
        let gate = TradingGate::default();
        let client = McpClient::new("test-token".to_owned());
        let names = write_tools();
        assert!(!names.is_empty());
        let off = run_batch(&client, &[], &gate, &calls_for(&names)).await;
        assert_eq!(off.len(), names.len());
        for (outcome, name) in off.iter().zip(&names) {
            assert_eq!(&outcome.name, name);
            assert!(!outcome.ok);
            assert_eq!(outcome.error.as_deref(), Some(TRADING_OFF), "{name}");
        }
        let ping = run_batch(&client, &[], &gate, &calls_for(&["ping".to_owned()])).await;
        assert_ne!(ping[0].error.as_deref(), Some(TRADING_OFF));

        gate.enabled.store(true, Ordering::SeqCst);
        let on = run_batch(&client, &[], &gate, &calls_for(&names)).await;
        for (outcome, name) in on.iter().zip(&names) {
            assert_ne!(outcome.error.as_deref(), Some(TRADING_OFF), "{name}");
            let expected = if BLOCKED_GENERIC_TOOLS.contains(&name.as_str()) {
                "own dialogs"
            } else {
                "did not offer"
            };
            assert!(
                outcome
                    .error
                    .as_deref()
                    .is_some_and(|e| e.contains(expected)),
                "{name}: {:?}",
                outcome.error
            );
        }

        // Switching off again (as sign-out does) closes the gate for the next batch.
        switch_trading(
            &gate,
            &TradeState::default(),
            &SavingsState::default(),
            false,
        );
        let again = run_batch(&client, &[], &gate, &calls_for(&names)).await;
        assert!(again
            .iter()
            .all(|outcome| outcome.error.as_deref() == Some(TRADING_OFF)));
    }

    #[test]
    fn a_batch_refused_as_a_whole_needs_no_session() {
        let gate = TradingGate::default();
        let refused: Vec<Option<String>> = calls_for(&write_tools())
            .iter()
            .map(|call| generic_refusal(&gate, &call.name))
            .collect();
        assert!(refused.iter().all(Option::is_some));
        assert!(generic_refusal(&gate, "get_portfolio_holdings").is_none());
        gate.enabled.store(true, Ordering::SeqCst);
        assert!(generic_refusal(&gate, "cancel_order").is_none());
        assert!(generic_refusal(&gate, "submit_buy_order").is_some());
    }

    /// The order submit command: refused while Trading is off, allowed once a preview is stored
    /// with Trading on, and refused again after the switch (or sign-out) dropped the preview.
    #[test]
    fn submit_order_is_blocked_off_allowed_on_and_cleared_by_the_switch() {
        let gate = TradingGate::default();
        let state = TradeState::default();
        let plans = SavingsState::default();
        let preview = json!({ "submission": { "confirmationProof": "c1" } });
        let request = buy_request();

        let off = take_submission(&gate, &state, "missing", &request, false).unwrap_err();
        assert!(off.starts_with(TRADING_OFF), "{off}");

        switch_trading(&gate, &state, &plans, true);
        let no_preview = take_submission(&gate, &state, "missing", &request, false).unwrap_err();
        assert!(
            no_preview.contains("Preview the order first"),
            "{no_preview}"
        );
        let preview_id = state
            .store_preview(&gate, request.clone(), preview.clone())
            .unwrap();
        let (tool, arguments) =
            take_submission(&gate, &state, &preview_id, &request, false).unwrap();
        assert_eq!(tool, "submit_buy_order");
        assert_eq!(arguments["submission"], preview["submission"]);
        // The preview is used up by the attempt.
        assert!(take_submission(&gate, &state, &preview_id, &request, false)
            .unwrap_err()
            .contains("Preview the order first"));

        // A preview stored before the switch went off (sign-out, or the user) does not survive it.
        state
            .store_preview(&gate, request.clone(), preview)
            .unwrap();
        switch_trading(&gate, &state, &plans, false);
        assert!(state.pending.lock().unwrap().is_empty());
        assert!(take_submission(&gate, &state, "missing", &request, false)
            .unwrap_err()
            .starts_with(TRADING_OFF));
        switch_trading(&gate, &state, &plans, true);
        assert!(take_submission(&gate, &state, "missing", &request, false)
            .unwrap_err()
            .contains("Preview the order first"));
    }

    #[test]
    fn submit_order_requires_the_same_request_and_the_accepted_warning() {
        let gate = TradingGate::default();
        gate.enabled.store(true, Ordering::SeqCst);
        let state = TradeState::default();
        let preview = json!({
            "submission": {
                "confirmationContext": { "requiredAcknowledgementIds": ["acknowledge_appropriateness_warning"] }
            }
        });
        let mut changed = buy_request();
        changed.amount = Some(600.0);
        let preview_id = state
            .store_preview(&gate, buy_request(), preview.clone())
            .unwrap();
        assert!(take_submission(&gate, &state, &preview_id, &changed, true)
            .unwrap_err()
            .contains("changed after the preview"));

        let preview_id = state
            .store_preview(&gate, buy_request(), preview.clone())
            .unwrap();
        assert!(
            take_submission(&gate, &state, &preview_id, &buy_request(), false)
                .unwrap_err()
                .contains("Accept the warning")
        );

        let preview_id = state.store_preview(&gate, buy_request(), preview).unwrap();
        let (_, arguments) =
            take_submission(&gate, &state, &preview_id, &buy_request(), true).unwrap();
        assert_eq!(
            arguments["acknowledgementIds"],
            json!(["acknowledge_appropriateness_warning"])
        );
    }

    #[test]
    fn classifies_trading_tools_like_the_ui() {
        for name in policy_names("trading") {
            assert!(is_trading_tool(&name), "{name} should be a trading tool");
            assert!(!is_manage_tool(&name), "{name} should not be a manage tool");
        }
        for name in policy_names("manage") {
            assert!(is_manage_tool(&name), "{name} should be a manage tool");
            assert!(
                !is_trading_tool(&name),
                "{name} should not be a trading tool"
            );
        }
        for name in policy_names("notTrading") {
            assert!(
                !is_trading_tool(&name) && !is_manage_tool(&name),
                "{name} should be a read tool"
            );
        }
    }

    #[test]
    fn trading_gate_starts_off_and_blocks_write_tools() {
        let gate = TradingGate::default();
        assert!(trading_block(&gate, "cancel_order").is_some());
        assert!(trading_block(&gate, "submit_savings_plan").is_some());
        assert!(trading_block(&gate, "remove_savings_plan").is_some());
        assert!(trading_block(&gate, "upsert_savings_plan").is_some());
        assert_eq!(trading_block(&gate, "create_price_alert"), Some(MANAGE_OFF));
        assert_eq!(trading_block(&gate, "add_watchlist_item"), Some(MANAGE_OFF));
        assert!(trading_block(&gate, "unknown_future_tool").is_some());
        for name in [
            "sell_portfolio_group_holdings",
            "submit_order_from_watchlist",
            "update_price_alert_order",
        ] {
            assert!(is_trading_tool(name), "{name} needs Full access");
        }
        assert!(trading_block(&gate, "get_portfolio_holdings").is_none());
        gate.enabled.store(true, Ordering::SeqCst);
        assert!(trading_block(&gate, "cancel_order").is_none());
        assert!(trading_block(&gate, "submit_savings_plan").is_none());
        gate.enabled.store(false, Ordering::SeqCst);
        assert!(trading_block(&gate, "cancel_order").is_some());
    }

    #[test]
    fn restricted_access_manages_lists_but_not_money() {
        let gate = TradingGate::default();
        let (orders, plans) = (TradeState::default(), SavingsState::default());
        switch_access(&gate, &orders, &plans, AccessMode::Restricted);
        for name in policy_names("manage") {
            assert!(trading_block(&gate, &name).is_none(), "{name}");
        }
        for name in policy_names("trading") {
            assert_eq!(trading_block(&gate, &name), Some(TRADING_OFF), "{name}");
        }
        assert_eq!(call_block(&gate, "preview_buy_order"), Some(TRADING_OFF));
        switch_access(&gate, &orders, &plans, AccessMode::Readonly);
        assert_eq!(trading_block(&gate, "add_watchlist_item"), Some(MANAGE_OFF));
        switch_access(&gate, &orders, &plans, AccessMode::Full);
        assert!(trading_block(&gate, "add_watchlist_item").is_none());
    }

    #[test]
    fn submit_tools_are_not_reachable_from_the_generic_runner() {
        for name in [
            "submit_buy_order",
            "submit_sell_order",
            "submit_savings_plan",
        ] {
            assert!(
                BLOCKED_GENERIC_TOOLS.contains(&name),
                "{name} must be blocked"
            );
            assert!(is_trading_tool(name));
        }
    }

    #[test]
    fn preview_is_not_stored_while_trading_is_off() {
        let gate = TradingGate::default();
        let state = TradeState::default();
        let stored = state.store_preview(&gate, buy_request(), json!({ "ok": 1 }));
        assert!(stored.is_err());
        assert!(state.pending.lock().unwrap().is_empty());

        gate.enabled.store(true, Ordering::SeqCst);
        assert!(state
            .store_preview(&gate, buy_request(), json!({ "ok": 1 }))
            .is_ok());
        assert_eq!(state.pending.lock().unwrap().len(), 1);

        // Switched off while the next preview was in flight: it must not replace or survive.
        gate.enabled.store(false, Ordering::SeqCst);
        assert!(state
            .store_preview(&gate, buy_request(), json!({ "ok": 2 }))
            .is_err());
        assert!(state.pending.lock().unwrap().is_empty());
    }

    #[test]
    fn clear_pending_drops_the_stored_preview() {
        let gate = TradingGate::default();
        gate.enabled.store(true, Ordering::SeqCst);
        let state = TradeState::default();
        state
            .store_preview(&gate, buy_request(), json!({}))
            .unwrap();
        state.clear_pending();
        assert!(state.pending.lock().unwrap().is_empty());
    }

    #[test]
    fn previews_are_independent_one_time_and_bounded() {
        let gate = TradingGate::default();
        gate.enabled.store(true, Ordering::SeqCst);
        let state = TradeState::default();
        let ids: Vec<String> = (0..MAX_PENDING_PREVIEWS)
            .map(|index| {
                state
                    .store_preview(&gate, buy_request(), json!({ "index": index }))
                    .unwrap()
            })
            .collect();
        assert_eq!(state.pending.lock().unwrap().len(), MAX_PENDING_PREVIEWS);

        let newest = state
            .store_preview(
                &gate,
                buy_request(),
                json!({ "index": MAX_PENDING_PREVIEWS }),
            )
            .unwrap();
        assert!(
            state.take(&ids[0]).is_err(),
            "the oldest preview is evicted"
        );
        let taken = state.take(&ids[3]).unwrap();
        assert_eq!(taken.preview["index"], 3);
        assert!(state.take(&ids[3]).is_err(), "a preview is used only once");
        assert_eq!(
            state.take(&newest).unwrap().preview["index"],
            MAX_PENDING_PREVIEWS
        );
    }

    fn buy_request() -> OrderRequest {
        OrderRequest {
            side: "buy".to_owned(),
            isin: "US0378331005".to_owned(),
            portfolio_id: Some("p-1".to_owned()),
            amount: Some(500.0),
            shares: None,
            order_type: "market".to_owned(),
            limit_price: None,
            stop_price: None,
            venue: None,
        }
    }

    #[test]
    fn validates_order_requests() {
        assert!(buy_request().validate().is_ok());
        let mut both = buy_request();
        both.shares = Some(2.0);
        assert!(both.validate().is_err());
        let mut fractional = buy_request();
        fractional.amount = None;
        fractional.shares = Some(1.5);
        assert!(fractional.validate().is_err());
        let mut limit = buy_request();
        limit.order_type = "limit".to_owned();
        assert!(limit.validate().is_err());
        limit.limit_price = Some(10.0);
        assert!(limit.validate().is_ok());
        let mut bad_isin = buy_request();
        bad_isin.isin = "nope".to_owned();
        assert!(bad_isin.validate().is_err());
        let mut venue = buy_request();
        venue.venue = Some("gettex".to_owned());
        assert!(venue.validate().is_ok());
        venue.venue = Some("Gettex/../".to_owned());
        assert!(venue.validate().is_err());
        venue.venue = Some(String::new());
        assert!(venue.validate().is_err());
    }

    #[test]
    fn preview_arguments_follow_the_published_schemas() {
        let schemas = crate::mcp::fixtures::input_schemas();
        let buy = preview_arguments(&buy_request());
        assert_eq!(
            buy,
            json!({
                "isin": "US0378331005",
                "portfolioId": "p-1",
                "quantity": { "mode": "amount", "amount": 500 },
                "order": { "type": "market" }
            })
        );
        let mut sell = buy_request();
        sell.side = "sell".to_owned();
        sell.amount = None;
        sell.shares = Some(2.0);
        sell.order_type = "limit".to_owned();
        sell.limit_price = Some(12.5);
        sell.stop_price = Some(99.0);
        sell.venue = Some("gettex".to_owned());
        let arguments = preview_arguments(&sell);
        assert_eq!(arguments["venue"], "gettex");
        assert_eq!(
            arguments["quantity"],
            json!({ "mode": "shares", "shares": 2 })
        );
        assert_eq!(
            arguments["order"],
            json!({ "type": "limit", "limitPrice": 12.5 })
        );
        for (name, arguments) in [
            ("preview_buy_order", buy),
            ("preview_sell_order", arguments),
        ] {
            crate::mcp::fixtures::assert_matches(&schemas, name, &arguments);
        }
    }

    #[test]
    fn submit_passes_the_preview_submission_and_accepted_acknowledgements() {
        let preview = json!({
            "submission": {
                "executionIntent": { "isin": "US0378331005" },
                "confirmationContext": { "requiredAcknowledgementIds": ["acknowledge_appropriateness_warning"] },
                "confirmationProof": "c1.x"
            },
            "userReview": "{}"
        });
        let submission = submission_of(&preview).unwrap();
        let required = required_acknowledgements(submission);
        assert_eq!(required, ["acknowledge_appropriateness_warning"]);
        let arguments = submit_arguments(submission, &required);
        assert_eq!(arguments["submission"], preview["submission"]);
        assert_eq!(
            arguments["acknowledgementIds"],
            json!(["acknowledge_appropriateness_warning"])
        );
        let schemas = crate::mcp::fixtures::input_schemas();
        crate::mcp::fixtures::assert_matches(&schemas, "submit_buy_order", &arguments);
        assert!(submission_of(&json!({ "userReview": "{}" })).is_err());
        assert!(required_acknowledgements(&json!({})).is_empty());
    }
}
