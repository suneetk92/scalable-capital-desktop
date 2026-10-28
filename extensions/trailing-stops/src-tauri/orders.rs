//! The sale or purchase of a stop that was hit: preview, checks, submit and the notice to the user.

use super::{
    announce_change, quotes::quote_price, watcher::trigger_price, Side, Status, TrailingState,
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

/// What the preview of the order says about going ahead.
#[derive(Debug, PartialEq)]
enum Verdict {
    Go,
    /// Try again at the next check: nothing is wrong with the stop itself.
    Wait(String),
    /// Stop watching and tell the user: only they can accept this or complete it in Scalable.
    Attention(String),
}

fn done(side: Side) -> &'static str {
    match side {
        Side::Sell => "sold",
        Side::Buy => "bought",
    }
}

fn assess(preview: &Value, submission: &Value, trigger: f64, side: Side) -> Verdict {
    if preview.pointer("/suitability/questionnaireRequired") == Some(&Value::Bool(true)) {
        return Verdict::Attention(
            format!("Scalable asks you to complete a suitability questionnaire before this can be {}. Do it yourself in Scalable.", done(side)),
        );
    }
    if !required_acknowledgements(submission).is_empty() {
        return Verdict::Attention(
            format!("Scalable needs you to accept a warning before this can be {}. Place the order yourself.", done(side)),
        );
    }
    if preview.pointer("/tradability/tradable") == Some(&Value::Bool(false)) {
        return Verdict::Wait(format!(
            "Scalable cannot take a {} order for this security right now. The app will try again.",
            side.word()
        ));
    }
    if preview.pointer("/marketQuote/isOutdated") == Some(&Value::Bool(true)) {
        return Verdict::Wait(
            "The price Scalable would use is outdated, so the market may be closed. The app will try again.".to_owned(),
        );
    }
    let off = preview
        .get("marketQuote")
        .and_then(|quote| quote_price(quote, side))
        .is_some_and(|price| match side {
            Side::Sell => price < trigger * 0.75,
            Side::Buy => price > trigger * 1.25,
        });
    if off {
        return Verdict::Attention(format!(
            "The {} quote is more than 25% {} the price that triggered the stop. Review and {} manually in Scalable.",
            side.word(),
            if side == Side::Sell { "below" } else { "above" },
            side.word()
        ));
    }
    Verdict::Go
}

enum Outcome {
    Done(f64, serde_json::Value),
    /// Nothing was placed; the stop stays active.
    Retry(String),
    /// Not repeated, because it needs the user or may or may not have gone through.
    Attention(String),
}

async fn try_trade(app: &AppHandle, stop: &TrailingStop) -> Outcome {
    let gate = app.state::<TradingGate>();
    if !gate.is_on() {
        return Outcome::Retry(TRADING_OFF.to_owned());
    }
    let request = OrderRequest {
        side: stop.side.word().to_owned(),
        isin: stop.isin.clone(),
        portfolio_id: stop.portfolio_id.clone(),
        amount: stop.amount.filter(|_| stop.side == Side::Buy),
        shares: (stop.side == Side::Sell).then_some(stop.shares),
        order_type: "market".to_owned(),
        limit_price: None,
        stop_price: None,
        venue: None,
    };
    let (preview_tool, submit_tool) = match stop.side {
        Side::Sell => ("preview_sell_order", "submit_sell_order"),
        Side::Buy => ("preview_buy_order", "submit_buy_order"),
    };
    // A preview changes nothing at Scalable, so it may be repeated on a new session.
    let preview = session::call_tool(
        app,
        preview_tool,
        preview_arguments(&request),
        session::Retry::ReadOnly,
        TRADING_UNAVAILABLE,
    )
    .await;
    let preview = match preview {
        Ok(preview) => preview,
        Err(error) => {
            return Outcome::Retry(format!(
                "Scalable did not accept the {} order: {error}",
                stop.side.word()
            ))
        }
    };
    let submission = match submission_of(&preview) {
        Ok(submission) => submission,
        Err(error) => return Outcome::Retry(error),
    };
    match assess(
        &preview,
        submission,
        trigger_price(stop.side, stop.high, stop.trail),
        stop.side,
    ) {
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
        submit_tool,
        submit_arguments(submission, &[]),
        session::Retry::Never,
        TRADING_UNAVAILABLE,
    )
    .await
    {
        Ok(receipt) => {
            let price = preview
                .get("marketQuote")
                .and_then(|q| quote_price(q, stop.side))
                .unwrap_or(stop.last_price.unwrap_or(trigger_price(stop.side, stop.high, stop.trail)));
            Outcome::Done(price, receipt)
        }
        Err(error) => Outcome::Attention(format!(
            "{error}. The order may or may not have gone through: check your transactions in Scalable before doing anything else."
        )),
    }
}

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

/// Sells or buys for a stop that was hit and records how it went. `stop` is already marked as selling.
pub(super) async fn execute(app: &AppHandle, stop: TrailingStop) {
    let outcome = try_trade(app, &stop).await;
    let (status, message, sold_price, receipt) = match &outcome {
        Outcome::Done(price, receipt) => (
            Status::Sold,
            Some(match stop.side {
                Side::Sell => format!("Sold at {:.2}", price),
                Side::Buy => format!("Bought at {:.2}", price),
            }),
            Some(*price),
            Some(receipt.clone()),
        ),
        Outcome::Retry(message) => (Status::Active, Some(message.clone()), None, None),
        Outcome::Attention(message) => (Status::Attention, Some(message.clone()), None, None),
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
                item.sold_price = sold_price;
                item.executed_at = receipt.as_ref().map(|_| now_seconds());
                item.receipt = receipt.clone();
                earlier
            })
    });
    let _ = state.persist(app);
    announce_change(app);
    let name = &stop.name;
    let (done_title, needs_title, wait_title, hit, done_text) = match stop.side {
        Side::Sell => (
            "Trailing stop sold",
            "Trailing stop needs you",
            "Trailing stop could not sell yet",
            "its trailing stop",
            format!(
                "{name}: the price fell to your trailing stop, so {} shares were sold at market.",
                stop.shares
            ),
        ),
        Side::Buy => (
            "Trailing buy stop bought",
            "Trailing buy stop needs you",
            "Trailing buy stop could not buy yet",
            "its trailing buy stop",
            format!(
                "{name}: the price rose to your trailing buy stop, so {} was spent at market.",
                stop.amount.unwrap_or_default()
            ),
        ),
    };
    match outcome {
        Outcome::Done(..) => notify::send(app, done_title, &done_text),
        Outcome::Attention(message) => {
            notify::send(app, needs_title, &format!("{name}: {message}"))
        }
        // One notice per stop, not one per check.
        Outcome::Retry(message) if earlier.is_none() => {
            notify::send(app, wait_title, &format!("{name} hit {hit}. {message}"))
        }
        Outcome::Retry(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::fixtures::{assert_matches, input_schemas};
    use crate::ext_trailing_stops::Trail;
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
        assert_eq!(
            assess(&preview, &preview["submission"], 100.0, Side::Sell),
            Verdict::Go
        );
    }

    #[test]
    fn a_warning_to_accept_is_never_accepted_for_the_user() {
        let preview = json!({ "submission": { "confirmationContext": { "requiredAcknowledgementIds": ["warn"] } } });
        assert!(matches!(
            assess(&preview, &preview["submission"], 100.0, Side::Sell),
            Verdict::Attention(_)
        ));
    }

    #[test]
    fn a_questionnaire_needs_the_user() {
        let preview = json!({ "submission": {}, "suitability": { "questionnaireRequired": true } });
        assert!(matches!(
            assess(&preview, &preview["submission"], 100.0, Side::Sell),
            Verdict::Attention(_)
        ));
    }

    #[test]
    fn a_closed_market_or_outdated_quote_waits() {
        let closed = json!({ "submission": {}, "tradability": { "tradable": false } });
        assert!(matches!(
            assess(&closed, &closed["submission"], 100.0, Side::Sell),
            Verdict::Wait(_)
        ));
        let outdated = json!({ "submission": {}, "marketQuote": { "isOutdated": true } });
        assert!(matches!(
            assess(&outdated, &outdated["submission"], 100.0, Side::Sell),
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
            assess(&steep_drop, &steep_drop["submission"], 100.0, Side::Sell),
            Verdict::Attention(_)
        ));

        let boundary = json!({
            "submission": {},
            "marketQuote": { "bidPrice": 75.0, "isOutdated": false }
        });
        assert_eq!(
            assess(&boundary, &boundary["submission"], 100.0, Side::Sell),
            Verdict::Go
        );
    }

    #[test]
    fn a_wide_trail_still_sells_when_the_quote_is_at_its_trigger() {
        let trigger = trigger_price(Side::Sell, 100.0, Trail::Percent(30.0));
        let quote = json!({
            "submission": {},
            "marketQuote": { "bidPrice": 69.0, "isOutdated": false }
        });
        assert_eq!(
            assess(&quote, &quote["submission"], trigger, Side::Sell),
            Verdict::Go
        );
    }

    #[test]
    fn the_buy_preview_arguments_follow_the_published_schema() {
        let request = OrderRequest {
            side: "buy".to_owned(),
            isin: "US0378331005".to_owned(),
            portfolio_id: Some("p-1".to_owned()),
            amount: Some(250.0),
            shares: None,
            order_type: "market".to_owned(),
            limit_price: None,
            stop_price: None,
            venue: None,
        };
        assert_matches(
            &input_schemas(),
            "preview_buy_order",
            &preview_arguments(&request),
        );
    }

    #[test]
    fn a_buy_quote_more_than_25_percent_above_the_trigger_needs_manual_review() {
        let steep_rise = json!({
            "submission": {},
            "marketQuote": { "askPrice": 125.01, "isOutdated": false }
        });
        assert!(matches!(
            assess(&steep_rise, &steep_rise["submission"], 100.0, Side::Buy),
            Verdict::Attention(_)
        ));
        let boundary = json!({
            "submission": {},
            "marketQuote": { "askPrice": 125.0, "isOutdated": false }
        });
        assert_eq!(
            assess(&boundary, &boundary["submission"], 100.0, Side::Buy),
            Verdict::Go
        );
    }
}
