#![allow(dead_code)]

use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum JsonlCodecError {
    #[error("JSON line is empty")]
    EmptyLine,
    #[error("Failed to parse JSON line: {0}")]
    Parse(#[from] serde_json::Error),
}

pub fn encode_json_line(value: &Value) -> Result<String, JsonlCodecError> {
    let mut encoded = serde_json::to_string(value)?;
    encoded.push('\n');
    Ok(encoded)
}

pub fn decode_json_line(line: &str) -> Result<Value, JsonlCodecError> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err(JsonlCodecError::EmptyLine);
    }
    Ok(serde_json::from_str(trimmed)?)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{decode_json_line, encode_json_line, JsonlCodecError};

    #[test]
    fn roundtrips_json_message() {
        let value = json!({"id": 1, "method": "ping"});
        let encoded = encode_json_line(&value).expect("encodes");
        let decoded = decode_json_line(&encoded).expect("decodes");
        assert_eq!(decoded, value);
    }

    #[test]
    fn rejects_malformed_json() {
        let error = decode_json_line("{\"id\":").expect_err("should fail");
        assert!(matches!(error, JsonlCodecError::Parse(_)));
    }
}
