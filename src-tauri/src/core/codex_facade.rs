#![allow(dead_code)]

use std::collections::HashMap;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use thiserror::Error;

use super::app_server_process::{AppServerProcess, AppServerProcessError};
use super::events::{JsonRpcErrorPayload, RpcResponsePayload};
use super::lifecycle::LifecycleState;
use super::retry::{backoff_delay, is_overload_response, RetryPolicy};

pub trait RpcRuntime {
    fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<RpcResponsePayload, String>;
    fn notify(&mut self, method: &str, params: Value) -> Result<(), String>;
    fn is_running(&mut self) -> Result<bool, String>;
    fn restart(&mut self) -> Result<(), String>;
}

pub struct RealRuntime {
    codex_path: Option<String>,
    env_vars: HashMap<String, String>,
    process: AppServerProcess,
}

impl RealRuntime {
    pub fn new(
        codex_path: Option<String>,
        env_vars: HashMap<String, String>,
    ) -> Result<Self, AppServerProcessError> {
        let process = AppServerProcess::spawn(codex_path.as_deref(), env_vars.clone())?;
        Ok(Self {
            codex_path,
            env_vars,
            process,
        })
    }
}

impl RpcRuntime for RealRuntime {
    fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<RpcResponsePayload, String> {
        self.process
            .request(method, params, timeout)
            .map_err(|error| error.to_string())
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.process
            .notify(method, params)
            .map_err(|error| error.to_string())
    }

    fn is_running(&mut self) -> Result<bool, String> {
        self.process.is_running().map_err(|error| error.to_string())
    }

    fn restart(&mut self) -> Result<(), String> {
        let _ = self.process.terminate();
        self.process = AppServerProcess::spawn(self.codex_path.as_deref(), self.env_vars.clone())
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum CodexFacadeError {
    #[error("Codex facade is not initialized. Call initialize() before API requests.")]
    NotInitialized,
    #[error("RPC runtime error: {0}")]
    Runtime(String),
    #[error("JSON-RPC response returned error: code={code}, message={message}")]
    RpcError { code: i64, message: String },
    #[error("App-server overload persisted after retries")]
    Overloaded,
    #[error("Unexpected JSON-RPC response payload")]
    UnexpectedPayload,
}

pub struct CodexFacade<R: RpcRuntime> {
    runtime: R,
    state: LifecycleState,
    retry_policy: RetryPolicy,
    request_timeout: Duration,
    client_version: String,
}

impl<R: RpcRuntime> CodexFacade<R> {
    pub fn new(runtime: R, client_version: impl Into<String>) -> Self {
        Self {
            runtime,
            state: LifecycleState::Starting,
            retry_policy: RetryPolicy::default(),
            request_timeout: Duration::from_secs(15),
            client_version: client_version.into(),
        }
    }

    pub fn with_retry_policy(mut self, retry_policy: RetryPolicy) -> Self {
        self.retry_policy = retry_policy;
        self
    }

    pub fn initialize(&mut self) -> Result<(), CodexFacadeError> {
        self.perform_handshake()?;
        self.state = LifecycleState::Initialized;
        Ok(())
    }

    pub fn account_read(&mut self, refresh_token: bool) -> Result<Value, CodexFacadeError> {
        self.request_json("account/read", json!({ "refreshToken": refresh_token }))
    }

    pub fn account_login_start_chatgpt(&mut self) -> Result<Value, CodexFacadeError> {
        self.request_json("account/login/start", json!({ "type": "chatgpt" }))
    }

    pub fn account_logout(&mut self) -> Result<Value, CodexFacadeError> {
        self.request_json("account/logout", json!({}))
    }

    pub fn thread_start(&mut self, cwd: &str) -> Result<Value, CodexFacadeError> {
        self.request_json("thread/start", json!({ "cwd": cwd }))
    }

    pub fn thread_resume(&mut self, thread_id: &str) -> Result<Value, CodexFacadeError> {
        self.request_json("thread/resume", json!({ "threadId": thread_id }))
    }

    pub fn thread_list_app_server_only(&mut self) -> Result<Value, CodexFacadeError> {
        self.request_json("thread/list", json!({ "sourceKinds": ["appServer"] }))
    }

    pub fn turn_start(
        &mut self,
        thread_id: &str,
        text: &str,
        cwd: &str,
    ) -> Result<Value, CodexFacadeError> {
        self.request_json(
            "turn/start",
            json!({
                "threadId": thread_id,
                "cwd": cwd,
                "input": [
                    { "type": "text", "text": text }
                ]
            }),
        )
    }

    pub fn turn_interrupt(
        &mut self,
        thread_id: &str,
        turn_id: &str,
    ) -> Result<Value, CodexFacadeError> {
        self.request_json(
            "turn/interrupt",
            json!({ "threadId": thread_id, "turnId": turn_id }),
        )
    }

    fn request_json(&mut self, method: &str, params: Value) -> Result<Value, CodexFacadeError> {
        self.ensure_ready()?;

        for attempt in 0..self.retry_policy.max_attempts {
            let response = self
                .runtime
                .request(method, params.clone(), self.request_timeout)
                .map_err(CodexFacadeError::Runtime)?;

            if is_overload_response(&response) {
                if attempt + 1 >= self.retry_policy.max_attempts {
                    return Err(CodexFacadeError::Overloaded);
                }
                thread::sleep(backoff_delay(self.retry_policy, attempt));
                continue;
            }

            return Self::extract_result(response);
        }

        Err(CodexFacadeError::Overloaded)
    }

    fn ensure_ready(&mut self) -> Result<(), CodexFacadeError> {
        if !self.state.allows_requests() {
            return Err(CodexFacadeError::NotInitialized);
        }

        let running = self
            .runtime
            .is_running()
            .map_err(CodexFacadeError::Runtime)?;
        if running {
            return Ok(());
        }

        let previous_state = self.state;
        self.state = LifecycleState::Recovering;
        if let Err(error) = self.runtime.restart().map_err(CodexFacadeError::Runtime) {
            self.state = previous_state;
            return Err(error);
        }
        if let Err(error) = self.perform_handshake() {
            self.state = previous_state;
            return Err(error);
        }
        self.state = LifecycleState::Initialized;
        Ok(())
    }

    fn perform_handshake(&mut self) -> Result<(), CodexFacadeError> {
        let init_response = self
            .runtime
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "minico",
                        "title": "minico",
                        "version": self.client_version,
                    }
                }),
                self.request_timeout,
            )
            .map_err(CodexFacadeError::Runtime)?;

        let _ = Self::extract_result(init_response)?;
        self.runtime
            .notify("initialized", json!({}))
            .map_err(CodexFacadeError::Runtime)?;
        Ok(())
    }

    fn extract_result(response: RpcResponsePayload) -> Result<Value, CodexFacadeError> {
        match response {
            RpcResponsePayload::Result(value) => Ok(value),
            RpcResponsePayload::Error(JsonRpcErrorPayload { code, message, .. }) => {
                Err(CodexFacadeError::RpcError { code, message })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use serde_json::json;

    use super::{
        CodexFacade, CodexFacadeError, JsonRpcErrorPayload, LifecycleState, RetryPolicy,
        RpcResponsePayload, RpcRuntime,
    };

    #[derive(Default)]
    struct MockRuntime {
        running: bool,
        request_log: Vec<String>,
        notify_log: Vec<String>,
        responses: VecDeque<RpcResponsePayload>,
        restart_count: u32,
    }

    impl MockRuntime {
        fn with_running(running: bool) -> Self {
            Self {
                running,
                ..Self::default()
            }
        }
    }

    impl RpcRuntime for MockRuntime {
        fn request(
            &mut self,
            method: &str,
            _params: serde_json::Value,
            _timeout: std::time::Duration,
        ) -> Result<RpcResponsePayload, String> {
            self.request_log.push(method.to_string());
            Ok(self
                .responses
                .pop_front()
                .unwrap_or(RpcResponsePayload::Result(json!({}))))
        }

        fn notify(&mut self, method: &str, _params: serde_json::Value) -> Result<(), String> {
            self.notify_log.push(method.to_string());
            Ok(())
        }

        fn is_running(&mut self) -> Result<bool, String> {
            Ok(self.running)
        }

        fn restart(&mut self) -> Result<(), String> {
            self.running = true;
            self.restart_count += 1;
            Ok(())
        }
    }

    #[test]
    fn rejects_requests_before_initialize() {
        let runtime = MockRuntime::with_running(true);
        let mut facade = CodexFacade::new(runtime, "0.1.0");
        let error = facade.account_read(false).expect_err("must fail");
        assert!(matches!(error, CodexFacadeError::NotInitialized));
    }

    #[test]
    fn initialize_runs_handshake() {
        let mut runtime = MockRuntime::with_running(true);
        runtime
            .responses
            .push_back(RpcResponsePayload::Result(json!({})));

        let mut facade = CodexFacade::new(runtime, "0.1.0");
        facade.initialize().expect("initialize");
        assert_eq!(facade.state, LifecycleState::Initialized);
    }

    #[test]
    fn retries_overload_then_succeeds() {
        let mut runtime = MockRuntime::with_running(true);
        runtime
            .responses
            .push_back(RpcResponsePayload::Result(json!({}))); // initialize
        runtime
            .responses
            .push_back(RpcResponsePayload::Error(JsonRpcErrorPayload {
                code: -32001,
                message: "overload".to_string(),
                data: None,
            }));
        runtime
            .responses
            .push_back(RpcResponsePayload::Error(JsonRpcErrorPayload {
                code: -32001,
                message: "overload".to_string(),
                data: None,
            }));
        runtime
            .responses
            .push_back(RpcResponsePayload::Result(json!({"ok": true})));

        let mut facade = CodexFacade::new(runtime, "0.1.0").with_retry_policy(RetryPolicy {
            max_attempts: 5,
            base_delay_ms: 1,
        });
        facade.initialize().expect("initialize");

        let result = facade.account_read(false).expect("request result");
        assert_eq!(result, json!({"ok": true}));
    }

    #[test]
    fn returns_overloaded_when_retry_budget_is_exhausted() {
        let mut runtime = MockRuntime::with_running(true);
        runtime
            .responses
            .push_back(RpcResponsePayload::Result(json!({}))); // initialize
        runtime
            .responses
            .push_back(RpcResponsePayload::Error(JsonRpcErrorPayload {
                code: -32001,
                message: "overload".to_string(),
                data: None,
            }));
        runtime
            .responses
            .push_back(RpcResponsePayload::Error(JsonRpcErrorPayload {
                code: -32001,
                message: "overload".to_string(),
                data: None,
            }));
        runtime
            .responses
            .push_back(RpcResponsePayload::Error(JsonRpcErrorPayload {
                code: -32001,
                message: "overload".to_string(),
                data: None,
            }));

        let mut facade = CodexFacade::new(runtime, "0.1.0").with_retry_policy(RetryPolicy {
            max_attempts: 3,
            base_delay_ms: 1,
        });
        facade.initialize().expect("initialize");

        let error = facade.account_read(false).expect_err("must fail");
        assert!(matches!(error, CodexFacadeError::Overloaded));
    }

    #[test]
    fn restarts_and_reinitializes_when_process_is_down() {
        let mut runtime = MockRuntime::with_running(true);
        runtime
            .responses
            .push_back(RpcResponsePayload::Result(json!({}))); // initial initialize
        runtime
            .responses
            .push_back(RpcResponsePayload::Result(json!({}))); // reinitialize
        runtime
            .responses
            .push_back(RpcResponsePayload::Result(json!({"account": null}))); // account_read

        let mut facade = CodexFacade::new(runtime, "0.1.0");
        facade.initialize().expect("initialize");
        facade.runtime.running = false;

        let result = facade.account_read(false).expect("request result");
        assert_eq!(result, json!({"account": null}));
        assert_eq!(facade.runtime.restart_count, 1);
        assert_eq!(
            facade.runtime.notify_log,
            vec!["initialized", "initialized"]
        );
    }
}
