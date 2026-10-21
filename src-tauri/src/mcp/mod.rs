//! Scalable Capital MCP access. One module per responsibility:
//! `client` (JSON-RPC over HTTP), `session` (shared session cache), `args` (argument helpers), `response` (reading tool answers), `dashboard` (read-only dashboard load), `trading` (the Trading
//! gate, tool runner and orders), `savings` (the savings-plan preview and submit) and `trailing` (trailing stop loss, watched
//! locally and sold through the same gate).

pub mod args;
pub mod client;
pub mod dashboard;
pub mod response;
pub mod savings;
pub mod session;
pub mod trading;
pub mod trailing;

/// The published input schemas of Scalable's tools, for the tests that check the arguments the app builds.
#[cfg(test)]
mod fixtures {
    use serde_json::Value;

    pub fn input_schemas() -> Value {
        let file: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/mcp-input-schemas.json"
        ))
        .expect("tests/fixtures/mcp-input-schemas.json is valid");
        file["tools"].clone()
    }

    fn has_type(value: &Value, kind: &str) -> bool {
        match kind {
            "string" => value.is_string(),
            "integer" => value.is_i64() || value.is_u64(),
            "number" => value.is_number(),
            "boolean" => value.is_boolean(),
            "array" => value.is_array(),
            "object" => value.is_object(),
            _ => true,
        }
    }

    /// Every argument is a property of the tool, every required property is set, and plain types agree.
    pub fn assert_matches(schemas: &Value, tool: &str, arguments: &Value) {
        let schema = schemas
            .get(tool)
            .unwrap_or_else(|| panic!("no schema for {tool}"));
        let properties = schema["properties"].as_object().expect("properties");
        let arguments = arguments.as_object().expect("arguments are an object");
        for (name, value) in arguments {
            let property = properties
                .get(name)
                .unwrap_or_else(|| panic!("{tool} has no property {name}"));
            if let Some(kind) = property.get("type").and_then(Value::as_str) {
                assert!(has_type(value, kind), "{tool}.{name} should be a {kind}");
            }
        }
        for name in schema["required"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            assert!(arguments.contains_key(name), "{tool} needs {name}");
        }
    }
}
