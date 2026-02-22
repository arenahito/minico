use std::time::Duration;
use std::{fs, time::SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use super::config::{load_snapshot, LogLevel};
use super::events::RpcEvent;
use super::paths;
use super::session_runtime::{with_facade, SessionRuntimeState};
use super::workspace::workspace_resolve_active_cwd;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListResult {
    pub threads: Vec<ThreadSummary>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSessionResult {
    pub thread_id: String,
    pub cwd: String,
    pub workspace_fallback_used: bool,
    pub workspace_warning: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartResult {
    pub thread_id: String,
    pub turn_id: Option<String>,
    pub cwd: String,
    pub workspace_fallback_used: bool,
    pub workspace_warning: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExportResult {
    pub log_path: String,
    pub line_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SessionPolledEvent {
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

fn extract_thread_id(payload: &Value) -> Option<String> {
    payload
        .get("thread")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn extract_turn_id(payload: &Value) -> Option<String> {
    payload
        .get("turn")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn parse_thread_list(payload: &Value) -> ThreadListResult {
    let threads = payload
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id").and_then(Value::as_str)?;
                    let preview = item
                        .get("preview")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    Some(ThreadSummary {
                        id: id.to_string(),
                        preview,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    ThreadListResult { threads }
}

#[tauri::command]
pub fn session_poll_events(
    state: State<'_, SessionRuntimeState>,
    timeout_ms: Option<u64>,
    max_events: Option<u32>,
) -> Result<Vec<SessionPolledEvent>, String> {
    with_facade(&state, |facade| {
        let first_wait = Duration::from_millis(timeout_ms.unwrap_or(0).min(5000));
        let max_count = max_events.unwrap_or(32).clamp(1, 128) as usize;
        let mut events = Vec::new();

        for index in 0..max_count {
            let wait = if index == 0 {
                first_wait
            } else {
                Duration::from_millis(0)
            };
            let Some(event) = facade.poll_event(wait).map_err(|error| error.to_string())? else {
                break;
            };

            let mapped = match event {
                RpcEvent::Notification { method, params } => {
                    SessionPolledEvent::Notification { method, params }
                }
                RpcEvent::ServerRequest { id, method, params } => {
                    SessionPolledEvent::ServerRequest { id, method, params }
                }
                RpcEvent::MalformedLine { raw, reason } => {
                    SessionPolledEvent::MalformedLine { raw, reason }
                }
            };
            events.push(mapped);
        }

        Ok(events)
    })
}

#[tauri::command]
pub fn thread_list(state: State<'_, SessionRuntimeState>) -> Result<ThreadListResult, String> {
    with_facade(&state, |facade| {
        let payload = facade
            .thread_list_app_server_only()
            .map_err(|error| error.to_string())?;
        Ok(parse_thread_list(&payload))
    })
}

#[tauri::command]
pub fn thread_start(state: State<'_, SessionRuntimeState>) -> Result<ThreadSessionResult, String> {
    let cwd = workspace_resolve_active_cwd()?;
    with_facade(&state, |facade| {
        let payload = facade
            .thread_start(&cwd.cwd)
            .map_err(|error| error.to_string())?;
        let thread_id = extract_thread_id(&payload)
            .ok_or_else(|| "thread/start response did not include thread.id".to_string())?;
        Ok(ThreadSessionResult {
            thread_id,
            cwd: cwd.cwd.clone(),
            workspace_fallback_used: cwd.fallback_used,
            workspace_warning: cwd.warning.clone(),
        })
    })
}

#[tauri::command]
pub fn thread_resume(
    state: State<'_, SessionRuntimeState>,
    thread_id: String,
) -> Result<ThreadSessionResult, String> {
    let cwd = workspace_resolve_active_cwd()?;
    with_facade(&state, |facade| {
        let payload = facade
            .thread_resume(&thread_id)
            .map_err(|error| error.to_string())?;
        let resolved_thread_id = extract_thread_id(&payload).unwrap_or(thread_id);
        Ok(ThreadSessionResult {
            thread_id: resolved_thread_id,
            cwd: cwd.cwd.clone(),
            workspace_fallback_used: cwd.fallback_used,
            workspace_warning: cwd.warning.clone(),
        })
    })
}

#[tauri::command]
pub fn turn_start(
    state: State<'_, SessionRuntimeState>,
    thread_id: String,
    text: String,
) -> Result<TurnStartResult, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("turn/start requires non-empty input text".to_string());
    }

    let cwd = workspace_resolve_active_cwd()?;
    with_facade(&state, |facade| {
        let payload = facade
            .turn_start(&thread_id, trimmed, &cwd.cwd)
            .map_err(|error| error.to_string())?;
        Ok(TurnStartResult {
            thread_id,
            turn_id: extract_turn_id(&payload),
            cwd: cwd.cwd.clone(),
            workspace_fallback_used: cwd.fallback_used,
            workspace_warning: cwd.warning.clone(),
        })
    })
}

#[tauri::command]
pub fn turn_interrupt(
    state: State<'_, SessionRuntimeState>,
    thread_id: String,
    turn_id: String,
) -> Result<(), String> {
    with_facade(&state, |facade| {
        let _ = facade
            .turn_interrupt(&thread_id, &turn_id)
            .map_err(|error| error.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn approval_respond(
    state: State<'_, SessionRuntimeState>,
    request_id: u64,
    decision: Value,
) -> Result<(), String> {
    if decision.is_null() {
        return Err("approval decision must not be null".to_string());
    }

    with_facade(&state, |facade| {
        facade
            .respond_to_server_request(request_id, json!({ "decision": decision }))
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub fn diagnostics_drain_stderr(
    state: State<'_, SessionRuntimeState>,
) -> Result<Vec<String>, String> {
    with_facade(&state, |facade| {
        facade.drain_stderr().map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub fn diagnostics_export_logs(
    state: State<'_, SessionRuntimeState>,
) -> Result<DiagnosticsExportResult, String> {
    let snapshot = load_snapshot().map_err(|error| error.to_string())?;
    let home = paths::home_dir().map_err(|error| error.to_string())?;
    let lines = with_facade(&state, |facade| {
        facade.drain_stderr().map_err(|error| error.to_string())
    })?;
    let filtered = filter_diagnostics_lines(&lines, snapshot.config.diagnostics.log_level);
    write_diagnostics_log(&home, &filtered).map_err(|error| error.to_string())
}

fn filter_diagnostics_lines(lines: &[String], level: LogLevel) -> Vec<String> {
    let matches = |line: &str, needles: &[&str]| {
        let lowered = line.to_ascii_lowercase();
        needles.iter().any(|needle| lowered.contains(needle))
    };

    lines
        .iter()
        .filter(|line| match level {
            LogLevel::Debug | LogLevel::Info => true,
            LogLevel::Warn => matches(line, &["warn", "error", "fail"]),
            LogLevel::Error => matches(line, &["error", "fatal", "panic"]),
        })
        .cloned()
        .collect()
}

fn write_diagnostics_log(
    home: &std::path::Path,
    lines: &[String],
) -> Result<DiagnosticsExportResult, std::io::Error> {
    let log_dir = paths::minico_dir_from_home(home).join("logs");
    fs::create_dir_all(&log_dir)?;

    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let file_path = log_dir.join(format!("diagnostics-{timestamp}.log"));
    let body = if lines.is_empty() {
        "No app-server stderr lines captured yet.\n".to_string()
    } else {
        let mut joined = lines.join("\n");
        joined.push('\n');
        joined
    };
    fs::write(&file_path, body)?;

    Ok(DiagnosticsExportResult {
        log_path: file_path.display().to_string(),
        line_count: lines.len(),
    })
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::json;
    use tempfile::TempDir;

    use super::{
        extract_thread_id, extract_turn_id, filter_diagnostics_lines, parse_thread_list,
        write_diagnostics_log,
    };
    use crate::core::config::LogLevel;

    #[test]
    fn extracts_thread_id_from_thread_payload() {
        let payload = json!({
            "thread": {
                "id": "thread-1"
            }
        });
        assert_eq!(extract_thread_id(&payload).as_deref(), Some("thread-1"));
    }

    #[test]
    fn extracts_turn_id_from_turn_payload() {
        let payload = json!({
            "turn": {
                "id": "turn-42"
            }
        });
        assert_eq!(extract_turn_id(&payload).as_deref(), Some("turn-42"));
    }

    #[test]
    fn parses_thread_list_data() {
        let parsed = parse_thread_list(&json!({
            "data": [
                { "id": "thread-a", "preview": "alpha" },
                { "id": "thread-b", "preview": "beta" }
            ]
        }));
        assert_eq!(parsed.threads.len(), 2);
        assert_eq!(parsed.threads[0].id, "thread-a");
        assert_eq!(parsed.threads[1].preview, "beta");
    }

    #[test]
    fn writes_diagnostics_log_file() {
        let temp = TempDir::new().expect("temp dir");
        let home = Path::new(temp.path());
        let lines = vec!["stderr line 1".to_string(), "stderr line 2".to_string()];

        let exported = write_diagnostics_log(home, &lines).expect("export");
        assert!(exported.log_path.contains("diagnostics-"));
        assert_eq!(exported.line_count, 2);
    }

    #[test]
    fn filters_diagnostics_lines_by_log_level() {
        let lines = vec![
            "INFO startup ok".to_string(),
            "WARN retrying request".to_string(),
            "ERROR failed to connect".to_string(),
        ];

        let warn = filter_diagnostics_lines(&lines, LogLevel::Warn);
        let error = filter_diagnostics_lines(&lines, LogLevel::Error);

        assert_eq!(warn.len(), 2);
        assert_eq!(error.len(), 1);
    }
}
