//! Prices of the watched securities, from `get_security_quote`.

use crate::mcp::{
    client::require_tool,
    response::finite_number,
    session::{self, is_stale_session_error},
};
use serde_json::{json, Map, Value};
use tauri::AppHandle;

/// What a sale would get: the bid, else the mid price. Scalable sends them as numbers or strings.
pub(super) fn quote_price(quote: &Value) -> Option<f64> {
    ["bidPrice", "midPrice"].iter().find_map(|key| {
        quote
            .get(key)
            .and_then(finite_number)
            .filter(|price| *price > 0.0)
    })
}

fn quote_arguments(isin: &str, portfolio_id: Option<&str>) -> Value {
    let mut arguments = Map::new();
    arguments.insert("isin".to_owned(), json!(isin));
    if let Some(id) = portfolio_id.filter(|id| !id.is_empty()) {
        arguments.insert("portfolioId".to_owned(), json!(id));
    }
    Value::Object(arguments)
}

/// The latest price of every ISIN, `None` for one Scalable gave no price for. A rejected
/// session is the only failure that is raised, so the quote calls can be repeated on a new one.
pub(super) async fn quote_prices(
    app: &AppHandle,
    targets: Vec<(String, Option<String>)>,
) -> Result<Vec<(String, Option<f64>)>, String> {
    session::with_session(app, |mut mcp, tools| {
        let targets = targets.clone();
        async move {
            require_tool(&tools, "get_security_quote")?;
            let mut prices = Vec::with_capacity(targets.len());
            for (isin, portfolio_id) in targets {
                let arguments = quote_arguments(&isin, portfolio_id.as_deref());
                let price = match mcp.call_tool("get_security_quote", arguments).await {
                    Ok(quote) => quote_price(&quote),
                    Err(error) if is_stale_session_error(&error) => return Err(error),
                    Err(_) => None,
                };
                prices.push((isin, price));
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
        assert_eq!(
            quote_price(&json!({ "bidPrice": "9.5", "midPrice": 10 })),
            Some(9.5)
        );
        assert_eq!(quote_price(&json!({ "midPrice": 10.25 })), Some(10.25));
        assert_eq!(
            quote_price(&json!({ "bidPrice": 0, "midPrice": "10" })),
            Some(10.0)
        );
        assert_eq!(quote_price(&json!({ "bidPrice": "x" })), None);
        assert_eq!(quote_price(&json!({})), None);
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
