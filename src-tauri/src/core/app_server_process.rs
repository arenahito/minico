#![allow(dead_code)]

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::Value;
use thiserror::Error;

use super::events::{RpcEvent, RpcResponsePayload};
use super::rpc_client::{RpcClient, RpcClientError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppServerCommand {
    pub executable: String,
    pub args: Vec<String>,
}

impl AppServerCommand {
    pub fn from_codex_path(codex_path: Option<&str>) -> Self {
        let executable = codex_path
            .map(ToString::to_string)
            .unwrap_or_else(default_codex_executable);
        Self {
            executable,
            args: vec!["app-server".to_string()],
        }
    }
}

fn default_codex_executable() -> String {
    #[cfg(windows)]
    {
        "codex.cmd".to_string()
    }
    #[cfg(not(windows))]
    {
        "codex".to_string()
    }
}

#[derive(Debug, Error)]
pub enum AppServerProcessError {
    #[error("Failed to spawn app-server process: {0}")]
    Spawn(std::io::Error),
    #[error("Failed to read app-server process status: {0}")]
    Status(std::io::Error),
    #[error("Failed to terminate app-server process: {0}")]
    Terminate(std::io::Error),
    #[error("App-server stdio stream was unavailable")]
    MissingStdio,
    #[error(transparent)]
    Rpc(#[from] RpcClientError),
}

pub struct AppServerProcess {
    child: Child,
    rpc: RpcClient,
    stderr_lines: Arc<Mutex<Vec<String>>>,
}

impl AppServerProcess {
    pub fn spawn(
        codex_path: Option<&str>,
        env_vars: HashMap<String, String>,
    ) -> Result<Self, AppServerProcessError> {
        let command = AppServerCommand::from_codex_path(codex_path);
        let mut process = Command::new(&command.executable);
        process
            .args(&command.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        for (key, value) in env_vars {
            process.env(key, value);
        }

        let mut child = process.spawn().map_err(AppServerProcessError::Spawn)?;
        let stdin = child
            .stdin
            .take()
            .ok_or(AppServerProcessError::MissingStdio)?;
        let stdout = child
            .stdout
            .take()
            .ok_or(AppServerProcessError::MissingStdio)?;
        let stderr = child
            .stderr
            .take()
            .ok_or(AppServerProcessError::MissingStdio)?;

        let rpc = RpcClient::new(stdin, stdout);
        let stderr_lines = Arc::new(Mutex::new(Vec::new()));
        Self::spawn_stderr_collector(stderr, Arc::clone(&stderr_lines));

        Ok(Self {
            child,
            rpc,
            stderr_lines,
        })
    }

    pub fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<RpcResponsePayload, AppServerProcessError> {
        self.rpc
            .request(method, params, timeout)
            .map_err(AppServerProcessError::from)
    }

    pub fn notify(&self, method: &str, params: Value) -> Result<(), AppServerProcessError> {
        self.rpc
            .notify(method, params)
            .map_err(AppServerProcessError::from)
    }

    pub fn respond_result(&self, id: u64, result: Value) -> Result<(), AppServerProcessError> {
        self.rpc
            .respond_result(id, result)
            .map_err(AppServerProcessError::from)
    }

    pub fn respond_error(
        &self,
        id: u64,
        code: i64,
        message: &str,
        data: Option<Value>,
    ) -> Result<(), AppServerProcessError> {
        self.rpc
            .respond_error(id, code, message, data)
            .map_err(AppServerProcessError::from)
    }

    pub fn recv_event_timeout(
        &self,
        timeout: Duration,
    ) -> Result<Option<RpcEvent>, AppServerProcessError> {
        self.rpc
            .recv_event_timeout(timeout)
            .map_err(AppServerProcessError::from)
    }

    pub fn take_stderr_lines(&self) -> Vec<String> {
        let mut guard = self.stderr_lines.lock().expect("stderr lock");
        std::mem::take(&mut *guard)
    }

    pub fn terminate(&mut self) -> Result<(), AppServerProcessError> {
        self.child.kill().map_err(AppServerProcessError::Terminate)
    }

    pub fn is_running(&mut self) -> Result<bool, AppServerProcessError> {
        self.child
            .try_wait()
            .map(|status| status.is_none())
            .map_err(AppServerProcessError::Status)
    }

    fn spawn_stderr_collector(
        stderr: impl std::io::Read + Send + 'static,
        sink: Arc<Mutex<Vec<String>>>,
    ) {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => sink.lock().expect("stderr lock").push(text),
                    Err(error) => {
                        sink.lock().expect("stderr lock").push(error.to_string());
                        break;
                    }
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::fs;
    use std::time::Duration;

    use serde_json::json;
    use tempfile::TempDir;

    use super::{AppServerCommand, AppServerProcess};

    #[test]
    fn uses_path_lookup_when_codex_path_is_missing() {
        let command = AppServerCommand::from_codex_path(None);
        #[cfg(windows)]
        assert_eq!(command.executable, "codex.cmd");
        #[cfg(not(windows))]
        assert_eq!(command.executable, "codex");
        assert_eq!(command.args, vec!["app-server"]);
    }

    #[test]
    fn uses_explicit_codex_path_when_provided() {
        let command = AppServerCommand::from_codex_path(Some("C:\\codex\\codex.exe"));
        assert_eq!(command.executable, "C:\\codex\\codex.exe");
        assert_eq!(command.args, vec!["app-server"]);
    }

    #[cfg(windows)]
    #[test]
    fn starts_process_using_path_lookup_and_explicit_path() {
        let temp = TempDir::new().expect("temp dir");
        let fake_codex = temp.path().join("codex.cmd");
        fs::write(
            &fake_codex,
            "@echo off\r\nif \"%1\"==\"app-server\" (\r\n  :loop\r\n  set /p line=\r\n  if errorlevel 1 exit /b 0\r\n  echo %line%\r\n  goto loop\r\n)\r\n",
        )
        .expect("script");

        let path_env = format!(
            "{};{}",
            temp.path().display(),
            std::env::var("PATH").unwrap_or_default()
        );
        let mut env_vars = HashMap::new();
        env_vars.insert("PATH".to_string(), path_env);

        let mut by_path = AppServerProcess::spawn(None, env_vars).expect("path spawn");
        by_path
            .notify("health/ping", json!({"ok": true}))
            .expect("notify works");
        let _ = by_path.recv_event_timeout(Duration::from_millis(200));
        let _ = by_path.terminate();

        let mut by_explicit = AppServerProcess::spawn(
            Some(fake_codex.to_str().expect("utf8 path")),
            HashMap::new(),
        )
        .expect("explicit spawn");
        by_explicit
            .notify("health/ping", json!({"ok": true}))
            .expect("notify works");
        let _ = by_explicit.recv_event_timeout(Duration::from_millis(200));
        let _ = by_explicit.terminate();
    }
}
