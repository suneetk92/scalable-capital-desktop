use regex::Regex;
use serde_json::{json, Map, Value};

pub fn is_isin(text: &str) -> bool {
    text.len() == 12
        && text.chars().take(2).all(|c| c.is_ascii_uppercase())
        && text
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// True when the tool's input schema has a property of that exact name.
pub fn has_property(tool: &Value, name: &str) -> bool {
    tool.pointer("/inputSchema/properties")
        .and_then(Value::as_object)
        .is_some_and(|properties| properties.contains_key(name))
}

/// `{ "portfolioId": id }` for a tool that takes a portfolio, `{}` for one that does not.
pub fn portfolio_arguments(tool: &Value, portfolio_id: &str) -> Value {
    let mut arguments = Map::new();
    if has_property(tool, "portfolioId") {
        arguments.insert("portfolioId".to_owned(), json!(portfolio_id));
    }
    Value::Object(arguments)
}

/// Validates arguments against the input schema published for a tool. Tools without a usable
/// object schema retain their server-defined contract.
pub fn validate_arguments(tool: &Value, arguments: &Value) -> Result<(), String> {
    let Some(schema) = tool.pointer("/inputSchema") else {
        return Ok(());
    };
    let Some(properties) = schema.get("properties").and_then(Value::as_object) else {
        return Ok(());
    };
    let object = arguments
        .as_object()
        .ok_or_else(|| "arguments has the wrong type for the tool schema".to_owned())?;
    if let Some(unknown) = object
        .keys()
        .find(|name| !properties.contains_key(name.as_str()))
    {
        return Err(format!(
            "arguments.{unknown} is not allowed by the tool schema"
        ));
    }
    validate_schema(schema, arguments, "arguments", false)
}

fn validate_schema(
    schema: &Value,
    value: &Value,
    path: &str,
    optional: bool,
) -> Result<(), String> {
    if value.is_null() && optional && schema.get("nullable").and_then(Value::as_bool) != Some(true)
    {
        return Ok(());
    }
    if schema == &Value::Bool(true) {
        return Ok(());
    }
    if schema == &Value::Bool(false) {
        return Err(format!("{path} is not allowed by the tool schema"));
    }

    if let Some(expected) = schema.get("type") {
        let matches = match expected {
            Value::String(kind) => has_type(value, kind),
            Value::Array(kinds) => kinds
                .iter()
                .any(|kind| kind.as_str().is_some_and(|kind| has_type(value, kind))),
            _ => return Err(format!("The tool schema has an invalid type for {path}")),
        };
        if !(matches
            || value.is_null() && schema.get("nullable").and_then(Value::as_bool) == Some(true))
        {
            return Err(format!("{path} has the wrong type for the tool schema"));
        }
    }
    if let Some(constant) = schema.get("const") {
        if value != constant {
            return Err(format!("{path} does not match the tool schema"));
        }
    }
    if let Some(values) = schema.get("enum").and_then(Value::as_array) {
        if !values.contains(value) {
            return Err(format!("{path} is not an allowed value"));
        }
    }
    for keyword in ["anyOf", "oneOf"] {
        if let Some(choices) = schema.get(keyword).and_then(Value::as_array) {
            let matches = choices
                .iter()
                .filter(|choice| validate_schema(choice, value, path, false).is_ok())
                .count();
            let valid = if keyword == "anyOf" {
                matches > 0
            } else {
                matches == 1
            };
            if !valid {
                return Err(format!("{path} does not match the tool schema"));
            }
        }
    }

    if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
        let object = value
            .as_object()
            .ok_or_else(|| format!("{path} has the wrong type for the tool schema"))?;
        let required = schema
            .get("required")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for name in required.iter().filter_map(Value::as_str) {
            if !object.contains_key(name) {
                return Err(format!("{path}.{name} is required by the tool schema"));
            }
        }
        for (name, property_value) in object {
            if let Some(property_schema) = properties.get(name) {
                let is_required = required.iter().any(|item| item.as_str() == Some(name));
                validate_schema(
                    property_schema,
                    property_value,
                    &format!("{path}.{name}"),
                    !is_required,
                )?;
            } else if schema.get("additionalProperties") == Some(&Value::Bool(false)) {
                return Err(format!("{path}.{name} is not allowed by the tool schema"));
            } else if let Some(additional) = schema.get("additionalProperties") {
                if additional.is_object() || additional.is_boolean() {
                    validate_schema(additional, property_value, &format!("{path}.{name}"), true)?;
                }
            }
        }
    }

    if let Some(items) = schema.get("items") {
        let array = value
            .as_array()
            .ok_or_else(|| format!("{path} has the wrong type for the tool schema"))?;
        if schema
            .get("minItems")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| array.len() < minimum as usize)
        {
            return Err(format!("{path} has too few items"));
        }
        if schema
            .get("maxItems")
            .and_then(Value::as_u64)
            .is_some_and(|maximum| array.len() > maximum as usize)
        {
            return Err(format!("{path} has too many items"));
        }
        for (index, item) in array.iter().enumerate() {
            validate_schema(items, item, &format!("{path}[{index}]"), false)?;
        }
    }

    if let Some(text) = value.as_str() {
        if schema
            .get("minLength")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| text.chars().count() < minimum as usize)
        {
            return Err(format!("{path} is too short"));
        }
        if schema
            .get("maxLength")
            .and_then(Value::as_u64)
            .is_some_and(|maximum| text.chars().count() > maximum as usize)
        {
            return Err(format!("{path} is too long"));
        }
        if let Some(pattern) = schema.get("pattern").and_then(Value::as_str) {
            let regex = Regex::new(pattern)
                .map_err(|_| format!("The tool schema has an invalid pattern for {path}"))?;
            if !regex.is_match(text) {
                return Err(format!("{path} does not match the required format"));
            }
        }
    }
    if let Some(number) = value.as_f64() {
        if schema
            .get("minimum")
            .and_then(Value::as_f64)
            .is_some_and(|minimum| number < minimum)
            || schema
                .get("maximum")
                .and_then(Value::as_f64)
                .is_some_and(|maximum| number > maximum)
        {
            return Err(format!("{path} is outside the allowed range"));
        }
    }
    Ok(())
}

fn has_type(value: &Value, kind: &str) -> bool {
    match kind {
        "null" => value.is_null(),
        "string" => value.is_string(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "number" => value.is_number(),
        "boolean" => value.is_boolean(),
        "array" => value.is_array(),
        "object" => value.is_object(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_isins() {
        assert!(is_isin("US0378331005"));
        assert!(!is_isin("us0378331005"));
        assert!(!is_isin("US037833100"));
    }

    #[test]
    fn portfolio_id_is_sent_only_to_tools_that_take_it() {
        let with =
            json!({ "inputSchema": { "properties": { "portfolioId": { "type": "string" } } } });
        let without = json!({ "inputSchema": { "properties": {} } });
        assert_eq!(
            portfolio_arguments(&with, "p-1"),
            json!({ "portfolioId": "p-1" })
        );
        assert_eq!(portfolio_arguments(&without, "p-1"), json!({}));
    }

    #[test]
    fn validates_required_types_enums_and_unknown_properties() {
        let tool = json!({"inputSchema":{"type":"object","properties":{"side":{"type":"string","enum":["buy","sell"]},"quantity":{"type":"number"}},"required":["side"],"additionalProperties":false}});
        assert!(validate_arguments(&tool, &json!({"side":"buy","quantity":2})).is_ok());
        assert!(validate_arguments(&tool, &json!({"side":"hold"}))
            .unwrap_err()
            .contains("allowed value"));
        assert!(validate_arguments(&tool, &json!({"side":2}))
            .unwrap_err()
            .contains("wrong type"));
        assert!(
            validate_arguments(&tool, &json!({"side":"buy","unexpected":true}))
                .unwrap_err()
                .contains("not allowed")
        );
        assert!(validate_arguments(&tool, &json!({}))
            .unwrap_err()
            .contains("required"));
    }

    #[test]
    fn validates_nested_discriminators_patterns_and_numeric_bounds() {
        let tool = json!({"inputSchema":{"properties":{"instrument":{"oneOf":[{"type":"object","properties":{"kind":{"const":"security"},"isin":{"type":"string","pattern":"^[A-Z0-9]{12}$"}},"required":["kind","isin"],"additionalProperties":false},{"type":"object","properties":{"kind":{"const":"crypto"},"ticker":{"type":"string"}},"required":["kind","ticker"],"additionalProperties":false}]},"price":{"type":"number","minimum":0.01}}}});
        assert!(validate_arguments(
            &tool,
            &json!({"instrument":{"kind":"security","isin":"US0378331005"},"price":12.5})
        )
        .is_ok());
        assert!(validate_arguments(
            &tool,
            &json!({"instrument":{"kind":"security","isin":"bad"},"price":12.5})
        )
        .is_err());
        assert!(validate_arguments(
            &tool,
            &json!({"instrument":{"kind":"crypto","ticker":"BTC"},"price":0})
        )
        .is_err());
    }

    #[test]
    fn accepts_null_optional_values_and_missing_property_schemas() {
        let tool = json!({"inputSchema":{"properties":{"optional":{"type":"string"}}}});
        assert!(validate_arguments(&tool, &json!({"optional":null})).is_ok());
        assert!(validate_arguments(&json!({"inputSchema":{}}), &json!({"anything":true})).is_ok());
    }

    #[test]
    fn validates_arguments_against_the_published_price_alert_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/mcp-input-schemas.json"
        ))
        .unwrap();
        let tool = json!({"inputSchema": fixture["tools"]["create_price_alert"]});
        assert!(validate_arguments(
            &tool,
            &json!({"instrument":{"kind":"security","isin":"US0378331005"},"price":"200"})
        )
        .is_ok());
        assert!(validate_arguments(
            &tool,
            &json!({"instrument":{"kind":"crypto","ticker":"BTC"},"price":200})
        )
        .is_ok());
        assert!(validate_arguments(
            &tool,
            &json!({"instrument":{"kind":"security","ticker":"BTC"},"price":200})
        )
        .is_err());
    }
}
