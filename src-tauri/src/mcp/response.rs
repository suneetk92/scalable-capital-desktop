//! Reading what Scalable's tools answer. The output schemas are not copied into the app, so every
//! reader here is defensive: a value that is missing or of another type gives `None` or an empty list.

use serde_json::Value;

/// The `name` of a tool entry from `tools/list`.
pub fn tool_name(tool: &Value) -> Option<&str> {
    tool.get("name").and_then(Value::as_str)
}

/// The records of a tool answer: a list as it is, else the first of `preferred_keys` that holds
/// records, else the first list found among the values.
pub fn extract_records(value: &Value, preferred_keys: &[&str]) -> Vec<Value> {
    if let Some(items) = value.as_array() {
        return items.clone();
    }
    let Some(object) = value.as_object() else {
        return Vec::new();
    };
    for key in preferred_keys {
        if let Some(child) = object.get(*key) {
            let records = extract_records(child, preferred_keys);
            if !records.is_empty() {
                return records;
            }
        }
    }
    object
        .values()
        .find_map(|child| child.as_array().cloned())
        .unwrap_or_default()
}

/// The first of `keys` that the record has as a non-empty string or an unsigned number.
pub fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for key in keys {
        if let Some(value) = object.get(*key) {
            if let Some(text) = value.as_str() {
                if !text.is_empty() {
                    return Some(text.to_owned());
                }
            }
            if let Some(number) = value.as_u64() {
                return Some(number.to_string());
            }
        }
    }
    None
}

/// A finite number that Scalable sent as a number or as a numeric string.
pub fn finite_number(value: &Value) -> Option<f64> {
    let number = match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    };
    number.filter(|number| number.is_finite())
}

/// The strings of the list at a JSON pointer, none when it is missing or not a list.
pub fn strings_at(value: &Value, pointer: &str) -> Vec<String> {
    value
        .pointer(pointer)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_tool_name() {
        assert_eq!(tool_name(&json!({ "name": "ping" })), Some("ping"));
        assert_eq!(tool_name(&json!({ "name": 3 })), None);
        assert_eq!(tool_name(&json!({})), None);
    }

    #[test]
    fn unwraps_nested_records() {
        let response = json!({ "data": { "portfolios": [{ "portfolioId": "p-1" }] } });
        let rows = extract_records(&response, &["portfolios", "data"]);
        assert_eq!(rows.len(), 1);
        assert_eq!(
            find_string(&rows[0], &["portfolioId"]),
            Some("p-1".to_owned())
        );
    }

    #[test]
    fn records_come_from_a_list_a_preferred_key_or_the_first_list() {
        assert_eq!(extract_records(&json!([1, 2]), &[]).len(), 2);
        assert_eq!(
            extract_records(&json!({ "items": [1] }), &["items"]).len(),
            1
        );
        assert_eq!(
            extract_records(&json!({ "total": 3, "rows": [1, 2, 3] }), &[]).len(),
            3
        );
        assert!(extract_records(&json!("text"), &["items"]).is_empty());
        assert!(extract_records(&json!({ "items": [] }), &["items"]).is_empty());
    }

    #[test]
    fn finds_the_first_non_empty_string_or_number() {
        let record = json!({ "id": "", "portfolioId": "p-2", "count": 7 });
        assert_eq!(
            find_string(&record, &["id", "portfolioId"]),
            Some("p-2".to_owned())
        );
        assert_eq!(find_string(&record, &["count"]), Some("7".to_owned()));
        assert_eq!(find_string(&record, &["missing"]), None);
        assert_eq!(find_string(&json!([]), &["id"]), None);
    }

    #[test]
    fn numbers_may_be_numbers_or_numeric_strings() {
        assert_eq!(finite_number(&json!(10.25)), Some(10.25));
        assert_eq!(finite_number(&json!(" 9.5 ")), Some(9.5));
        assert_eq!(finite_number(&json!("x")), None);
        assert_eq!(finite_number(&json!("NaN")), None);
        assert_eq!(finite_number(&json!(null)), None);
    }

    #[test]
    fn reads_a_string_list_at_a_pointer() {
        let value = json!({ "a": { "ids": ["x", 1, "y"] } });
        assert_eq!(strings_at(&value, "/a/ids"), vec!["x", "y"]);
        assert!(strings_at(&value, "/a/missing").is_empty());
        assert!(strings_at(&json!({ "a": "x" }), "/a").is_empty());
    }
}
