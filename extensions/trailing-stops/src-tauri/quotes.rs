//! Prices of the watched securities, from `get_security_quote`.

use super::Side;
use crate::mcp::{
    client::require_tool,
    response::finite_number,
    session::{self, is_stale_session_error},
};
use serde_json::{json, Map, Value};
use tauri::AppHandle;

/// What the order would get: a sale the bid, a purchase the ask, then the mid price. Never the other side: a
/// stop that followed the ask and then the bid would see the spread as a price move. Scalable sends them as
/// numbers or strings.
pub(super) fn quote_price(quote: &Value, side: Side) -> Option<f64> {
    let keys = match side {
        Side::Sell => ["bidPrice", "midPrice"],
        Side::Buy => ["askPrice", "midPrice"],
    };
    keys.iter().find_map(|key| {
        quote
            .get(key)
            .and_then(finite_number)
            .filter(|price| *price > 0.0)
    })
}

/// Any price in an order preview's quote, the other side as a last resort: the check against the trigger is better
/// with some price than with none.
pub(super) fn any_quote_price(quote: &Value, side: Side) -> Option<f64> {
    let other = match side {
        Side::Sell => Side::Buy,
        Side::Buy => Side::Sell,
    };
    quote_price(quote, side).or_else(|| quote_price(quote, other))
}

/// The price in a `get_security_quote` answer, whose quote sits under `security.quote`.
fn security_quote_price(answer: &Value, side: Side) -> Option<f64> {
    ["/security/quote", "/quote", ""]
        .iter()
        .filter_map(|path| answer.pointer(path))
        .find_map(|quote| quote_price(quote, side))
}

/// The latest price of a security as a sale and as a purchase would get it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct Quote {
    pub sell: Option<f64>,
    pub buy: Option<f64>,
}

impl Quote {
    pub fn for_side(self, side: Side) -> Option<f64> {
        match side {
            Side::Sell => self.sell,
            Side::Buy => self.buy,
        }
    }
}

fn quote_arguments(isin: &str, portfolio_id: Option<&str>) -> Value {
    let mut arguments = Map::new();
    arguments.insert("isin".to_owned(), json!(isin));
    if let Some(id) = portfolio_id.filter(|id| !id.is_empty()) {
        arguments.insert("portfolioId".to_owned(), json!(id));
    }
    Value::Object(arguments)
}

/// The latest quote of every ISIN, empty for one Scalable gave no price for. A rejected
/// session is the only failure that is raised, so the quote calls can be repeated on a new one.
pub(super) async fn quote_prices(
    app: &AppHandle,
    targets: Vec<(String, Option<String>)>,
) -> Result<Vec<(String, Quote)>, String> {
    session::with_session(app, |mut mcp, tools| {
        let targets = targets.clone();
        async move {
            require_tool(&tools, "get_security_quote")?;
            let mut prices = Vec::with_capacity(targets.len());
            for (isin, portfolio_id) in targets {
                let arguments = quote_arguments(&isin, portfolio_id.as_deref());
                let quote = match mcp.call_tool("get_security_quote", arguments).await {
                    Ok(answer) => Quote {
                        sell: security_quote_price(&answer, Side::Sell),
                        buy: security_quote_price(&answer, Side::Buy),
                    },
                    Err(error) if is_stale_session_error(&error) => return Err(error),
                    Err(_) => Quote::default(),
                };
                prices.push((isin, quote));
            }
            Ok(prices)
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::fixtures::{assert_matches, input_schemas};

    #[test]
    fn the_price_is_the_bid_then_the_mid_as_number_or_text() {
        let sell = |quote: Value| quote_price(&quote, Side::Sell);
        assert_eq!(
            sell(json!({ "bidPrice": "9.5", "midPrice": 10 })),
            Some(9.5)
        );
        assert_eq!(sell(json!({ "midPrice": 10.25 })), Some(10.25));
        assert_eq!(sell(json!({ "bidPrice": 0, "midPrice": "10" })), Some(10.0));
        assert_eq!(sell(json!({ "bidPrice": "x" })), None);
        assert_eq!(sell(json!({})), None);
    }

    #[test]
    fn a_purchase_reads_the_ask_first() {
        let quote = json!({ "bidPrice": 9.5, "askPrice": 10.5, "midPrice": 10 });
        assert_eq!(quote_price(&quote, Side::Buy), Some(10.5));
        assert_eq!(quote_price(&quote, Side::Sell), Some(9.5));
        assert_eq!(
            quote_price(&json!({ "midPrice": 10 }), Side::Buy),
            Some(10.0)
        );
    }

    #[test]
    fn a_stop_never_reads_the_other_side_of_the_quote() {
        assert_eq!(quote_price(&json!({ "bidPrice": 9.5 }), Side::Buy), None);
        assert_eq!(quote_price(&json!({ "askPrice": 10.5 }), Side::Sell), None);
    }

    #[test]
    fn the_price_is_found_in_the_nested_security_quote() {
        let nested = json!({ "security": { "quote": { "bidPrice": 9.5, "midPrice": 10 } } });
        assert_eq!(security_quote_price(&nested, Side::Sell), Some(9.5));
        assert_eq!(
            security_quote_price(&json!({ "quote": { "midPrice": 10 } }), Side::Sell),
            Some(10.0)
        );
        assert_eq!(
            security_quote_price(&json!({ "midPrice": 10 }), Side::Sell),
            Some(10.0)
        );
        assert_eq!(
            security_quote_price(&json!({ "security": { "quote": null } }), Side::Sell),
            None
        );
    }

    #[test]
    fn quote_arguments_follow_the_published_schema() {
        let schemas = input_schemas();
        assert_matches(
            &schemas,
            "get_security_quote",
            &quote_arguments("US0378331005", None),
        );
        assert_matches(
            &schemas,
            "get_security_quote",
            &quote_arguments("US0378331005", Some("p-1")),
        );
    }
}
