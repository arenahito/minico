#![allow(dead_code)]

use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum RpcEvent {
    Notification {
        method: String,
        params: Value,
    },
    ServerRequest {
        id: u64,
        method: String,
        params: Value,
    },
    MalformedLine {
        raw: String,
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct JsonRpcErrorPayload {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RpcResponsePayload {
    Result(Value),
    Error(JsonRpcErrorPayload),
}
