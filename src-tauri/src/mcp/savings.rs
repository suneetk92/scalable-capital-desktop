//! Creating or changing a savings plan: `preview_savings_plan`, then `submit_savings_plan` with the
//! preview's `submission` unchanged. Same rules as orders: Trading must be on, a preview is used
//! once, and a failed or uncertain submission is never repeated automatically.

use super::{
    args::is_isin,
    session,
    trading::{number, submission_of, Previews, TradingGate, PREVIEW_TTL, TRADING_OFF},
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, State};

const UNAVAILABLE: &str = "Scalable MCP does not offer savings-plan tools for this sign-in. In the Scalable app open Profile > Security > Agentic Investing, set the MCP access level to Full access, then sign out here and sign in again.";

pub type SavingsState = Previews<SavingsPlanRequest>;

/// What the dialog asks for. Only the amount is needed; every other field falls back to the default
/// Scalable offers for the security (`get_savings_plan_config`).
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavingsPlanRequest {
    pub isin: String,
    #[serde(default)]
    pub portfolio_id: Option<String>,
    pub amount: f64,
    #[serde(default)]
    pub frequency: Option<String>,
    #[serde(default)]
    pub day_of_month: Option<u32>,
    #[serde(default)]
    pub year_month: Option<String>,
    #[serde(default)]
    pub dynamization_rate: Option<String>,
    #[serde(default)]
    pub payment_method: Option<String>,
}

/// Codes such as `MONTHLY` or `SEPA_DIRECT_DEBIT`.
fn is_code(text: &str) -> bool {
    let mut chars = text.chars();
    text.len() <= 64
        && chars.next().is_some_and(|first| first.is_ascii_uppercase())
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

fn is_year_month(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 7
        && bytes[4] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && matches!(
            &text[5..],
            "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12"
        )
}

impl SavingsPlanRequest {
    fn validate(&self) -> Result<(), String> {
        if !is_isin(&self.isin) {
            return Err("A valid 12-character ISIN is required".to_owned());
        }
        if !self.amount.is_finite() || self.amount <= 0.0 {
            return Err("The savings amount must be greater than zero".to_owned());
        }
        if self
            .day_of_month
            .is_some_and(|day| !(1..=31).contains(&day))
        {
            return Err("The day of the month must be between 1 and 31".to_owned());
        }
        if self
            .year_month
            .as_deref()
            .is_some_and(|text| !is_year_month(text))
        {
            return Err("The first execution month must look like 2026-11".to_owned());
        }
        for code in [&self.frequency, &self.payment_method]
            .into_iter()
            .flatten()
        {
            if !is_code(code) {
                return Err(format!("{code} is not a valid option"));
            }
        }
        if let Some(rate) = &self.dynamization_rate {
            let valid =
                rate.len() <= 64 && rate.parse::<f64>().is_ok_and(|v| v.is_finite() && v >= 0.0);
            if !valid {
                return Err("The dynamization rate must be a number, 0 or more".to_owned());
            }
        }
        Ok(())
    }
}

/// The arguments of `preview_savings_plan`, in the shape its input schema publishes.
fn preview_arguments(request: &SavingsPlanRequest) -> Value {
    let mut arguments = Map::new();
    arguments.insert("isin".to_owned(), json!(request.isin));
    arguments.insert("amount".to_owned(), number(request.amount));
    if let Some(id) = request.portfolio_id.as_deref().filter(|id| !id.is_empty()) {
        arguments.insert("portfolioId".to_owned(), json!(id));
    }
    if let Some(frequency) = &request.frequency {
        arguments.insert("frequency".to_owned(), json!(frequency));
    }
    if let Some(day) = request.day_of_month {
        arguments.insert("dayOfMonth".to_owned(), json!(day));
    }
    if let Some(year_month) = &request.year_month {
        arguments.insert("yearMonth".to_owned(), json!(year_month));
    }
    if let Some(rate) = &request.dynamization_rate {
        arguments.insert("dynamizationRate".to_owned(), json!(rate));
    }
    if let Some(method) = &request.payment_method {
        arguments.insert("paymentMethod".to_owned(), json!(method));
    }
    Value::Object(arguments)
}

/// The arguments of `submit_savings_plan`: the preview's `submission`, unchanged.
fn submit_arguments(submission: &Value) -> Value {
    json!({ "submission": submission })
}

#[tauri::command]
pub async fn preview_savings_plan(
    app: AppHandle,
    gate: State<'_, TradingGate>,
    state: State<'_, SavingsState>,
    request: SavingsPlanRequest,
) -> Result<Value, String> {
    request.validate()?;
    if !gate.is_on() {
        return Err(TRADING_OFF.to_owned());
    }
    // A preview changes nothing at Scalable, so it may be repeated on a new session.
    let preview = session::call_tool(
        &app,
        "preview_savings_plan",
        preview_arguments(&request),
        session::Retry::ReadOnly,
        UNAVAILABLE,
    )
    .await?;
    submission_of(&preview)?;
    let preview_id = state.store_preview(&gate, request, preview.clone())?;
    Ok(json!({ "previewId": preview_id, "preview": preview }))
}

#[tauri::command]
pub async fn submit_savings_plan(
    app: AppHandle,
    gate: State<'_, TradingGate>,
    state: State<'_, SavingsState>,
    preview_id: String,
    request: SavingsPlanRequest,
) -> Result<Value, String> {
    let arguments = take_submission(&gate, &state, &preview_id, &request)?;
    session::call_tool(
        &app,
        "submit_savings_plan",
        arguments,
        session::Retry::Never,
        UNAVAILABLE,
    )
        .await
        .map_err(|error| {
            format!("{error}. If you are not sure whether the plan was saved, check your savings plans in Scalable before trying again.")
        })
}

/// Everything `submit_savings_plan` checks before it sends anything: the gate and the one-time,
/// unchanged, fresh preview. The preview is removed before anything is sent.
fn take_submission(
    gate: &TradingGate,
    state: &SavingsState,
    preview_id: &str,
    request: &SavingsPlanRequest,
) -> Result<Value, String> {
    request.validate()?;
    if !gate.is_on() {
        return Err(format!("{TRADING_OFF} Nothing was saved."));
    }
    let pending = state.take(preview_id).map_err(|error| {
        if error.starts_with("Preview is no longer available") {
            "Preview the savings plan first. Nothing was saved.".to_owned()
        } else {
            error
        }
    })?;
    if pending.request != *request {
        return Err(
            "The savings plan changed after the preview. Preview it again. Nothing was saved."
                .to_owned(),
        );
    }
    if pending.created.elapsed() > PREVIEW_TTL {
        return Err(
            "The preview expired. Preview the savings plan again. Nothing was saved.".to_owned(),
        );
    }
    Ok(submit_arguments(submission_of(&pending.preview)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::trading::{switch_trading, TradeState};
    use std::sync::atomic::Ordering;

    /// The savings-plan submit command: refused while Trading is off, allowed once a preview is
    /// stored with Trading on, and refused again after the switch (or sign-out) dropped the preview.
    #[test]
    fn submit_is_blocked_off_allowed_on_and_cleared_by_the_switch() {
        let gate = TradingGate::default();
        let orders = TradeState::default();
        let state = SavingsState::default();
        let preview = json!({ "submission": { "confirmationProof": "s1" } });

        assert!(take_submission(&gate, &state, "missing", &request())
            .unwrap_err()
            .starts_with(TRADING_OFF));

        switch_trading(&gate, &orders, &state, true);
        assert!(take_submission(&gate, &state, "missing", &request())
            .unwrap_err()
            .contains("Preview the savings plan first"));
        let preview_id = state
            .store_preview(&gate, request(), preview.clone())
            .unwrap();
        let arguments = take_submission(&gate, &state, &preview_id, &request()).unwrap();
        assert_eq!(arguments["submission"], preview["submission"]);
        assert!(take_submission(&gate, &state, &preview_id, &request())
            .unwrap_err()
            .contains("Preview the savings plan first"));

        let preview_id = state
            .store_preview(&gate, request(), preview.clone())
            .unwrap();
        let mut changed = request();
        changed.amount = 75.0;
        assert!(take_submission(&gate, &state, &preview_id, &changed)
            .unwrap_err()
            .contains("changed after the preview"));

        state.store_preview(&gate, request(), preview).unwrap();
        switch_trading(&gate, &orders, &state, false);
        assert_eq!(state.pending_count(), 0);
        assert!(take_submission(&gate, &state, "missing", &request())
            .unwrap_err()
            .starts_with(TRADING_OFF));
        switch_trading(&gate, &orders, &state, true);
        assert!(take_submission(&gate, &state, "missing", &request())
            .unwrap_err()
            .contains("Preview the savings plan first"));
    }

    fn request() -> SavingsPlanRequest {
        SavingsPlanRequest {
            isin: "IE00B4L5Y983".to_owned(),
            portfolio_id: Some("p-1".to_owned()),
            amount: 50.0,
            frequency: Some("MONTHLY".to_owned()),
            day_of_month: Some(15),
            year_month: Some("2026-11".to_owned()),
            dynamization_rate: Some("0.05".to_owned()),
            payment_method: Some("SEPA_DIRECT_DEBIT".to_owned()),
        }
    }

    #[test]
    fn validates_savings_plan_requests() {
        assert!(request().validate().is_ok());
        let mut minimal = request();
        minimal.frequency = None;
        minimal.day_of_month = None;
        minimal.year_month = None;
        minimal.dynamization_rate = None;
        minimal.payment_method = None;
        assert!(minimal.validate().is_ok());
        for change in [
            |r: &mut SavingsPlanRequest| r.isin = "nope".to_owned(),
            |r: &mut SavingsPlanRequest| r.amount = 0.0,
            |r: &mut SavingsPlanRequest| r.amount = f64::NAN,
            |r: &mut SavingsPlanRequest| r.day_of_month = Some(32),
            |r: &mut SavingsPlanRequest| r.day_of_month = Some(0),
            |r: &mut SavingsPlanRequest| r.year_month = Some("2026-13".to_owned()),
            |r: &mut SavingsPlanRequest| r.year_month = Some("26-11".to_owned()),
            |r: &mut SavingsPlanRequest| r.frequency = Some("monthly".to_owned()),
            |r: &mut SavingsPlanRequest| r.payment_method = Some("A B".to_owned()),
            |r: &mut SavingsPlanRequest| r.dynamization_rate = Some("-1".to_owned()),
            |r: &mut SavingsPlanRequest| r.dynamization_rate = Some("lots".to_owned()),
        ] {
            let mut bad = request();
            change(&mut bad);
            assert!(bad.validate().is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn preview_arguments_follow_the_published_schema() {
        let schemas = crate::mcp::fixtures::input_schemas();
        let arguments = preview_arguments(&request());
        assert_eq!(
            arguments,
            json!({
                "isin": "IE00B4L5Y983",
                "amount": 50,
                "portfolioId": "p-1",
                "frequency": "MONTHLY",
                "dayOfMonth": 15,
                "yearMonth": "2026-11",
                "dynamizationRate": "0.05",
                "paymentMethod": "SEPA_DIRECT_DEBIT"
            })
        );
        crate::mcp::fixtures::assert_matches(&schemas, "preview_savings_plan", &arguments);
        let mut minimal = request();
        minimal.portfolio_id = None;
        minimal.frequency = None;
        minimal.day_of_month = None;
        minimal.year_month = None;
        minimal.dynamization_rate = None;
        minimal.payment_method = None;
        let arguments = preview_arguments(&minimal);
        assert_eq!(arguments, json!({ "isin": "IE00B4L5Y983", "amount": 50 }));
        crate::mcp::fixtures::assert_matches(&schemas, "preview_savings_plan", &arguments);
    }

    #[test]
    fn submit_passes_the_preview_submission_unchanged() {
        let preview = json!({
            "submission": {
                "executionIntent": { "isin": "IE00B4L5Y983" },
                "confirmationContext": { "costVenue": "SEIX" },
                "confirmationProof": "c1.x"
            },
            "userReview": "{}"
        });
        let arguments = submit_arguments(submission_of(&preview).unwrap());
        assert_eq!(arguments["submission"], preview["submission"]);
        let schemas = crate::mcp::fixtures::input_schemas();
        crate::mcp::fixtures::assert_matches(&schemas, "submit_savings_plan", &arguments);
        assert!(submission_of(&json!({ "userReview": "{}" })).is_err());
    }

    #[test]
    fn preview_is_not_stored_while_trading_is_off() {
        let gate = TradingGate::default();
        let state = SavingsState::default();
        assert!(state.store_preview(&gate, request(), json!({})).is_err());
        assert_eq!(state.pending_count(), 0);

        gate.enabled.store(true, Ordering::SeqCst);
        assert!(state.store_preview(&gate, request(), json!({})).is_ok());
        assert_eq!(state.pending_count(), 1);
        state.clear_pending();
        assert_eq!(state.pending_count(), 0);

        // Switched off while the next preview was in flight: it must not survive.
        assert!(state.store_preview(&gate, request(), json!({})).is_ok());
        gate.enabled.store(false, Ordering::SeqCst);
        assert!(state.store_preview(&gate, request(), json!({})).is_err());
        assert_eq!(state.pending_count(), 0);
    }
}
