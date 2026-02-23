#![allow(dead_code)]

use std::collections::HashMap;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use thiserror::Error;

use super::app_server_process::{AppServerProcess, AppServerProcessError};
use super::events::{JsonRpcErrorPayload, RpcEvent, RpcResponsePayload};
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
    fn respond_result(&mut self, id: u64, result: Value) -> Result<(), String>;
    fn recv_event_timeout(&mut self, timeout: Duration) -> Result<Option<RpcEvent>, String>;
    fn take_stderr_lines(&mut self) -> Result<Vec<String>, String>;
    fn is_running(&mut self) -> Result<bool, String>;
    fn restart(&mut self) -> Result<(), String>;
    fn shutdown(&mut self) -> Result<(), String>;
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

    fn respond_result(&mut self, id: u64, result: Value) -> Result<(), String> {
        self.process
            .respond_result(id, result)
            .map_err(|error| error.to_string())
    }

    fn recv_event_timeout(&mut self, timeout: Duration) -> Result<Option<RpcEvent>, String> {
        self.process
            .recv_event_timeout(timeout)
            .map_err(|error| error.to_string())
    }

    fn take_stderr_lines(&mut self) -> Result<Vec<String>, String> {
        Ok(self.process.take_stderr_lines())
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

    fn shutdown(&mut self) -> Result<(), String> {
        let running = self.process.is_running().map_err(|error| error.to_string())?;
        if !running {
            return Ok(());
        }
        self.process.terminate().map_err(|error| error.to_string())
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

    pub fn thread_list_app_server_only(
        &mut self,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Value, CodexFacadeError> {
        let mut params = json!({ "sourceKinds": ["vscode"] });
        if let Some(value) = cursor.map(str::trim).filter(|value| !value.is_empty()) {
            params["cursor"] = json!(value);
        }
        if let Some(value) = limit {
            params["limit"] = json!(value);
        }
        self.request_json("thread/list", params)
    }

    pub fn thread_archive(&mut self, thread_id: &str) -> Result<Value, CodexFacadeError> {
        self.request_json("thread/archive", json!({ "threadId": thread_id }))
    }

    pub fn model_list(&mut self) -> Result<Value, CodexFacadeError> {
        self.request_json("model/list", json!({}))
    }

    pub fn turn_start(
        &mut self,
        thread_id: &str,
        text: &str,
        model: Option<&str>,
        effort: Option<&str>,
        personality: Option<&str>,
        cwd: Option<&str>,
    ) -> Result<Value, CodexFacadeError> {
        let model = model
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        let effort = effort
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        let personality = personality
            .map(str::trim)
            .filter(|value| matches!(*value, "friendly" | "pragmatic" | "none"))
            .map(ToString::to_string);
        let cwd = cwd
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        let mut params = json!({
            "threadId": thread_id,
            "model": model,
            "effort": effort,
            "personality": personality,
            "input": [
                { "type": "text", "text": text }
            ]
        });
        if let Some(value) = cwd {
            params["cwd"] = json!(value);
        }
        self.request_json(
            "turn/start",
            params,
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

    pub fn poll_event(&mut self, timeout: Duration) -> Result<Option<RpcEvent>, CodexFacadeError> {
        self.ensure_ready()?;
        self.runtime
            .recv_event_timeout(timeout)
            .map_err(CodexFacadeError::Runtime)
    }

    pub fn respond_to_server_request(
        &mut self,
        id: u64,
        result: Value,
    ) -> Result<(), CodexFacadeError> {
        self.ensure_ready()?;
        self.runtime
            .respond_result(id, result)
            .map_err(CodexFacadeError::Runtime)
    }

    pub fn drain_stderr(&mut self) -> Result<Vec<String>, CodexFacadeError> {
        self.runtime
            .take_stderr_lines()
            .map_err(CodexFacadeError::Runtime)
    }

    pub fn shutdown(&mut self) -> Result<(), CodexFacadeError> {
        self.runtime.shutdown().map_err(CodexFacadeError::Runtime)?;
        self.state = LifecycleState::Starting;
        Ok(())
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

        self.state = LifecycleState::Recovering;
        if let Err(error) = self.runtime.restart().map_err(CodexFacadeError::Runtime) {
            self.state = LifecycleState::Starting;
            return Err(error);
        }
        if let Err(error) = self.perform_handshake() {
            self.state = LifecycleState::Starting;
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
        CodexFacade, CodexFacadeError, JsonRpcErrorPayload, LifecycleState, RetryPolicy, RpcEvent,
        RpcResponsePayload, RpcRuntime,
    };

    #[derive(Default)]
    struct MockRuntime {
        running: bool,
        request_log: Vec<String>,
        notify_log: Vec<String>,
        responses: VecDeque<RpcResponsePayload>,
        events: VecDeque<RpcEvent>,
        response_log: Vec<(u64, serde_json::Value)>,
        stderr_lines: Vec<String>,
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

        fn respond_result(&mut self, id: u64, result: serde_json::Value) -> Result<(), String> {
            self.response_log.push((id, result));
            Ok(())
        }

        fn recv_event_timeout(
            &mut self,
            _timeout: std::time::Duration,
        ) -> Result<Option<RpcEvent>, String> {
            Ok(self.events.pop_front())
        }

        fn take_stderr_lines(&mut self) -> Result<Vec<String>, String> {
            Ok(std::mem::take(&mut self.stderr_lines))
        }

        fn is_running(&mut self) -> Result<bool, String> {
            Ok(self.running)
        }

        fn restart(&mut self) -> Result<(), String> {
            self.running = true;
            self.restart_count += 1;
            Ok(())
        }

        fn shutdown(&mut self) -> Result<(), String> {
            self.running = false;
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

    #[test]
    fn failed_recovery_handshake_marks_facade_uninitialized() {
        let mut runtime = MockRuntime::with_running(true);
        runtime
            .responses
            .push_back(RpcResponsePayload::Result(json!({}))); // initial initialize
        runtime
            .responses
            .push_back(RpcResponsePayload::Error(JsonRpcErrorPayload {
                code: -32000,
                message: "initialize failed".to_string(),
                data: None,
            })); // reinitialize during recovery

        let mut facade = CodexFacade::new(runtime, "0.1.0");
        facade.initialize().expect("initialize");
        facade.runtime.running = false;

        let error = facade.account_read(false).expect_err("recovery must fail");
        assert!(matches!(error, CodexFacadeError::RpcError { .. }));
        assert_eq!(facade.state, LifecycleState::Starting);

        let second_error = facade
            .account_read(false)
            .expect_err("must remain uninitialized after failed recovery");
        assert!(matches!(second_error, CodexFacadeError::NotInitialized));
    }
}
