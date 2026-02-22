#![allow(dead_code)]

use std::time::Duration;

use super::events::{JsonRpcErrorPayload, RpcResponsePayload};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub base_delay_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 5,
            base_delay_ms: 200,
        }
    }
}

pub fn is_overload_response(response: &RpcResponsePayload) -> bool {
    matches!(
        response,
        RpcResponsePayload::Error(JsonRpcErrorPayload { code: -32001, .. })
    )
}

pub fn backoff_delay(policy: RetryPolicy, attempt_index: u32) -> Duration {
    let multiplier = 2u64.pow(attempt_index);
    Duration::from_millis(policy.base_delay_ms.saturating_mul(multiplier))
}

#[cfg(test)]
mod tests {
    use super::super::events::{JsonRpcErrorPayload, RpcResponsePayload};
    use super::{backoff_delay, is_overload_response, RetryPolicy};

    #[test]
    fn detects_overload_response() {
        let overload = RpcResponsePayload::Error(JsonRpcErrorPayload {
            code: -32001,
            message: "overload".to_string(),
            data: None,
        });
        let normal = RpcResponsePayload::Error(JsonRpcErrorPayload {
            code: -32603,
            message: "internal".to_string(),
            data: None,
        });
        assert!(is_overload_response(&overload));
        assert!(!is_overload_response(&normal));
    }

    #[test]
    fn computes_exponential_backoff() {
        let policy = RetryPolicy {
            max_attempts: 5,
            base_delay_ms: 50,
        };
        assert_eq!(backoff_delay(policy, 0).as_millis(), 50);
        assert_eq!(backoff_delay(policy, 1).as_millis(), 100);
        assert_eq!(backoff_delay(policy, 2).as_millis(), 200);
    }
}
