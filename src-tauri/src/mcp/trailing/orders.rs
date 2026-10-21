//! The sale of a stop that was hit: preview, checks, submit and the notice to the user.

use super::{
    announce_change, quotes::quote_price, watcher::trigger_price, Status, TrailingState,
    TrailingStop,
};
use crate::mcp::{
    session,
    trading::{
        preview_arguments, required_acknowledgements, submission_of, submit_arguments,
        OrderRequest, TradingGate, TRADING_OFF, TRADING_UNAVAILABLE,
    },
};
use crate::notify;
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// What the preview of the sale says about going ahead.
#[derive(Debug, PartialEq)]
enum Verdict {
    Go,
    /// Try again at the next check: nothing is wrong with the stop itself.
    Wait(String),
    /// Stop watching and tell the user: only they can accept this or complete it in Scalable.
    Attention(String),
}

fn assess(preview: &Value, submission: &Value, trigger: f64) -> Verdict {
    if preview.pointer("/suitability/questionnaireRequired") == Some(&Value::Bool(true)) {
        return Verdict::Attention(
            "Scalable asks you to complete a suitability questionnaire before this can be sold. Sell it yourself in Scalable.".to_owned(),
        );
    }
    if !required_acknowledgements(submission).is_empty() {
        return Verdict::Attention(
            "Scalable needs you to accept a warning before this can be sold. Sell it yourself with a sell order.".to_owned(),
        );
    }
    if preview.pointer("/tradability/tradable") == Some(&Value::Bool(false)) {
        return Verdict::Wait(
            "Scalable cannot take a sell order for this security right now. The app will try again.".to_owned(),
        );
    }
    if preview.pointer("/marketQuote/isOutdated") == Some(&Value::Bool(true)) {
        return Verdict::Wait(
            "The price Scalable would use is outdated, so the market may be closed. The app will try again.".to_owned(),
        );
    }
    if preview
        .get("marketQuote")
        .and_then(quote_price)
        .is_some_and(|price| price < trigger * 0.75)
    {
        return Verdict::Attention(
            "The sell quote is more than 25% below the price that triggered the stop. Review and sell manually in Scalable.".to_owned(),
        );
    }
    Verdict::Go
}

enum Outcome {
    Sold,
    /// Nothing was placed; the stop stays active.
    Retry(String),
    /// Not repeated, because it needs the user or may or may not have gone through.
    Attention(String),
}

async fn try_sell(app: &AppHandle, stop: &TrailingStop) -> Outcome {
    let gate = app.state::<TradingGate>();
    if !gate.is_on() {
        return Outcome::Retry(TRADING_OFF.to_owned());
    }
    let request = OrderRequest {
        side: "sell".to_owned(),
        isin: stop.isin.clone(),
        portfolio_id: stop.portfolio_id.clone(),
        amount: None,
        shares: Some(stop.shares),
        order_type: "market".to_owned(),
        limit_price: None,
        stop_price: None,
        venue: None,
    };
    // A preview changes nothing at Scalable, so it may be repeated on a new session.
    let preview = session::call_tool(
        app,
        "preview_sell_order",
        preview_arguments(&request),
        session::Retry::ReadOnly,
        TRADING_UNAVAILABLE,
    )
    .await;
    let preview = match preview {
        Ok(preview) => preview,
        Err(error) => {
            return Outcome::Retry(format!("Scalable did not accept the sell order: {error}"))
        }
    };
    let submission = match submission_of(&preview) {
        Ok(submission) => submission,
        Err(error) => return Outcome::Retry(error),
    };
    match assess(&preview, submission, trigger_price(stop.high, stop.trail)) {
        Verdict::Go => {}
        Verdict::Wait(message) => return Outcome::Retry(message),
        Verdict::Attention(message) => return Outcome::Attention(message),
    }
    if !gate.is_on() {
        return Outcome::Retry(TRADING_OFF.to_owned());
    }
    // Never rides on a cached session and is never repeated, like a submit from the order dialog.
    match session::call_tool(
        app,
        "submit_sell_order",
        submit_arguments(submission, &[]),
        session::Retry::Never,
        TRADING_UNAVAILABLE,
    )
    .await
    {
        Ok(_) => Outcome::Sold,
        Err(error) => Outcome::Attention(format!(
            "{error}. The sale may or may not have gone through: check your transactions in Scalable before doing anything else."
        )),
    }
}

/// Sells a stop that was hit and records how it went. `stop` is already marked as selling.
pub(super) async fn sell(app: &AppHandle, stop: TrailingStop) {
    let outcome = try_sell(app, &stop).await;
    let (status, message) = match &outcome {
        Outcome::Sold => (Status::Sold, Some("Sold at market.".to_owned())),
        Outcome::Retry(message) => (Status::Active, Some(message.clone())),
        Outcome::Attention(message) => (Status::Attention, Some(message.clone())),
    };
    let state = app.state::<TrailingState>();
    let earlier = state.mutate(|stops| {
        stops
            .iter_mut()
            .find(|item| item.id == stop.id)
            .and_then(|item| {
                let earlier = item.message.take();
                item.status = status;
                item.message = message.clone();
                earlier
            })
    });
    let _ = state.persist(app);
    announce_change(app);
    let name = &stop.name;
    match outcome {
        Outcome::Sold => notify::send(
            app,
            "Trailing stop sold",
            &format!(
                "{name}: the price fell to your trailing stop, so {} shares were sold at market.",
                stop.shares
            ),
        ),
        Outcome::Attention(message) => notify::send(
            app,
            "Trailing stop needs you",
            &format!("{name}: {message}"),
        ),
        // One notice per stop, not one per check.
        Outcome::Retry(message) if earlier.is_none() => notify::send(
            app,
            "Trailing stop could not sell yet",
            &format!("{name} hit its trailing stop. {message}"),
        ),
        Outcome::Retry(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::fixtures::{assert_matches, input_schemas};
    use crate::mcp::trailing::Trail;
    use serde_json::json;

    #[test]
    fn the_sell_preview_arguments_follow_the_published_schema() {
        let request = OrderRequest {
            side: "sell".to_owned(),
            isin: "US0378331005".to_owned(),
            portfolio_id: Some("p-1".to_owned()),
            amount: None,
            shares: Some(2.0),
            order_type: "market".to_owned(),
            limit_price: None,
            stop_price: None,
            venue: None,
        };
        assert_matches(
            &input_schemas(),
            "preview_sell_order",
            &preview_arguments(&request),
        );
    }

    #[test]
    fn a_clean_preview_goes_ahead() {
        let preview = json!({ "submission": { "confirmationContext": { "requiredAcknowledgementIds": [] } }, "tradability": { "tradable": true }, "marketQuote": { "isOutdated": false } });
        assert_eq!(assess(&preview, &preview["submission"], 100.0), Verdict::Go);
    }

    #[test]
    fn a_warning_to_accept_is_never_accepted_for_the_user() {
        let preview = json!({ "submission": { "confirmationContext": { "requiredAcknowledgementIds": ["warn"] } } });
        assert!(matches!(
            assess(&preview, &preview["submission"], 100.0),
            Verdict::Attention(_)
        ));
    }

    #[test]
    fn a_questionnaire_needs_the_user() {
        let preview = json!({ "submission": {}, "suitability": { "questionnaireRequired": true } });
        assert!(matches!(
            assess(&preview, &preview["submission"], 100.0),
            Verdict::Attention(_)
        ));
    }

    #[test]
    fn a_closed_market_or_outdated_quote_waits() {
        let closed = json!({ "submission": {}, "tradability": { "tradable": false } });
        assert!(matches!(
            assess(&closed, &closed["submission"], 100.0),
            Verdict::Wait(_)
        ));
        let outdated = json!({ "submission": {}, "marketQuote": { "isOutdated": true } });
        assert!(matches!(
            assess(&outdated, &outdated["submission"], 100.0),
            Verdict::Wait(_)
        ));
    }

    #[test]
    fn a_quote_more_than_25_percent_below_the_trigger_needs_manual_review() {
        let steep_drop = json!({
            "submission": {},
            "marketQuote": { "bidPrice": 74.99, "isOutdated": false }
        });
        assert!(matches!(
            assess(&steep_drop, &steep_drop["submission"], 100.0),
            Verdict::Attention(_)
        ));

        let boundary = json!({
            "submission": {},
            "marketQuote": { "bidPrice": 75.0, "isOutdated": false }
        });
        assert_eq!(
            assess(&boundary, &boundary["submission"], 100.0),
            Verdict::Go
        );
    }

    #[test]
    fn a_wide_trail_still_sells_when_the_quote_is_at_its_trigger() {
        let trigger = trigger_price(100.0, Trail::Percent(30.0));
        let quote = json!({
            "submission": {},
            "marketQuote": { "bidPrice": 69.0, "isOutdated": false }
        });
        assert_eq!(assess(&quote, &quote["submission"], trigger), Verdict::Go);
    }
}
