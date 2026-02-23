use std::collections::HashSet;
use std::time::Duration;
use std::{fs, time::SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use super::config::{load_snapshot, LogLevel};
use super::events::RpcEvent;
use super::paths;
use super::session_runtime::{run_blocking_task, run_with_facade, SessionRuntimeState};
use super::workspace::resolve_active_cwd;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
    pub name: Option<String>,
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListResult {
    pub threads: Vec<ThreadSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSummary {
    pub id: String,
    pub model: String,
    pub display_name: String,
    pub is_default: bool,
    pub default_reasoning_effort: Option<String>,
    pub supported_reasoning_efforts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListResult {
    pub models: Vec<ModelSummary>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSessionResult {
    pub thread_id: String,
    pub cwd: String,
    pub workspace_fallback_used: bool,
    pub workspace_warning: Option<String>,
    pub history_items: Vec<ThreadHistoryItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadHistoryItem {
    pub id: String,
    pub item_type: String,
    pub role: String,
    pub text: String,
    pub completed: bool,
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

fn extract_cwd(payload: &Value) -> Option<String> {
    payload
        .get("cwd")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .get("thread")
                .and_then(|thread| thread.get("cwd"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
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
                    let name = item
                        .get("name")
                        .and_then(Value::as_str)
                        .map(ToString::to_string);
                    let preview = item
                        .get("preview")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    Some(ThreadSummary {
                        id: id.to_string(),
                        name,
                        preview,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let next_cursor = payload
        .get("nextCursor")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    ThreadListResult {
        threads,
        next_cursor,
    }
}

fn parse_model_list(payload: &Value) -> ModelListResult {
    let models = payload
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id").and_then(Value::as_str)?;
                    let model = item.get("model").and_then(Value::as_str)?;
                    let display_name = item
                        .get("displayName")
                        .and_then(Value::as_str)
                        .unwrap_or(model)
                        .to_string();
                    let is_default = item
                        .get("isDefault")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let default_reasoning_effort = item
                        .get("defaultReasoningEffort")
                        .and_then(Value::as_str)
                        .map(ToString::to_string);
                    let supported_reasoning_efforts = item
                        .get("supportedReasoningEfforts")
                        .and_then(Value::as_array)
                        .map(|efforts| {
                            efforts
                                .iter()
                                .filter_map(|effort| {
                                    effort
                                        .get("reasoningEffort")
                                        .and_then(Value::as_str)
                                        .map(ToString::to_string)
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    Some(ModelSummary {
                        id: id.to_string(),
                        model: model.to_string(),
                        display_name,
                        is_default,
                        default_reasoning_effort,
                        supported_reasoning_efforts,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    ModelListResult { models }
}

fn user_content_text(content: &Value) -> String {
    let Some(parts) = content.as_array() else {
        return String::new();
    };
    let lines: Vec<String> = parts
        .iter()
        .filter_map(|part| {
            let kind = part.get("type").and_then(Value::as_str)?;
            if kind != "text" {
                return None;
            }
            part.get("text")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .collect();
    lines.join("\n")
}

fn parse_thread_history_items(payload: &Value) -> Vec<ThreadHistoryItem> {
    let Some(turns) = payload
        .get("thread")
        .and_then(|thread| thread.get("turns"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };

    let mut items = Vec::new();
    let mut seen_ids = HashSet::new();
    for turn in turns {
        let Some(turn_items) = turn.get("items").and_then(Value::as_array) else {
            continue;
        };
        for item in turn_items {
            let Some(id) = item.get("id").and_then(Value::as_str) else {
                continue;
            };
            if seen_ids.contains(id) {
                continue;
            }
            let Some(item_type) = item.get("type").and_then(Value::as_str) else {
                continue;
            };
            let parsed = match item_type {
                "userMessage" => {
                    let text = user_content_text(item.get("content").unwrap_or(&Value::Null));
                    Some(ThreadHistoryItem {
                        id: id.to_string(),
                        item_type: item_type.to_string(),
                        role: "user".to_string(),
                        text: if text.trim().is_empty() {
                            "(non-text input)".to_string()
                        } else {
                            text
                        },
                        completed: true,
                    })
                }
                "agentMessage" => {
                    let text = item
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    if text.trim().is_empty() {
                        None
                    } else {
                        Some(ThreadHistoryItem {
                            id: id.to_string(),
                            item_type: item_type.to_string(),
                            role: "agent".to_string(),
                            text,
                            completed: true,
                        })
                    }
                }
                _ => None,
            };
            if let Some(parsed_item) = parsed {
                seen_ids.insert(id.to_string());
                items.push(parsed_item);
            }
        }
    }
    items
}

#[tauri::command]
pub async fn session_poll_events(
    state: State<'_, SessionRuntimeState>,
    timeout_ms: Option<u64>,
    max_events: Option<u32>,
) -> Result<Vec<SessionPolledEvent>, String> {
    run_with_facade(&state, move |facade| {
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
    .await
}

#[tauri::command]
pub async fn thread_list(
    state: State<'_, SessionRuntimeState>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<ThreadListResult, String> {
    let normalized_cursor = cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let normalized_limit = limit.map(|value| value.clamp(1, 100));
    run_with_facade(&state, move |facade| {
        let payload = facade
            .thread_list_app_server_only(normalized_cursor.as_deref(), normalized_limit)
            .map_err(|error| error.to_string())?;
        Ok(parse_thread_list(&payload))
    })
    .await
}

#[tauri::command]
pub async fn model_list(state: State<'_, SessionRuntimeState>) -> Result<ModelListResult, String> {
    run_with_facade(&state, |facade| {
        let payload = facade.model_list().map_err(|error| error.to_string())?;
        Ok(parse_model_list(&payload))
    })
    .await
}

#[tauri::command]
pub async fn thread_start(
    state: State<'_, SessionRuntimeState>,
) -> Result<ThreadSessionResult, String> {
    run_with_facade(&state, |facade| {
        let cwd = resolve_active_cwd()?;
        let payload = facade
            .thread_start(&cwd.cwd)
            .map_err(|error| error.to_string())?;
        let thread_id = extract_thread_id(&payload)
            .ok_or_else(|| "thread/start response did not include thread.id".to_string())?;
        let resolved_cwd = extract_cwd(&payload).unwrap_or_else(|| cwd.cwd.clone());
        Ok(ThreadSessionResult {
            thread_id,
            cwd: resolved_cwd,
            workspace_fallback_used: cwd.fallback_used,
            workspace_warning: cwd.warning.clone(),
            history_items: vec![],
        })
    })
    .await
}

#[tauri::command]
pub async fn thread_resume(
    state: State<'_, SessionRuntimeState>,
    thread_id: String,
) -> Result<ThreadSessionResult, String> {
    run_with_facade(&state, move |facade| {
        let payload = facade
            .thread_resume(&thread_id)
            .map_err(|error| error.to_string())?;
        let resolved_thread_id = extract_thread_id(&payload).unwrap_or_else(|| thread_id.clone());
        let history_items = parse_thread_history_items(&payload);
        let resolved_cwd = extract_cwd(&payload)
            .ok_or_else(|| "thread/resume response did not include cwd".to_string())?;
        Ok(ThreadSessionResult {
            thread_id: resolved_thread_id,
            cwd: resolved_cwd,
            workspace_fallback_used: false,
            workspace_warning: None,
            history_items,
        })
    })
    .await
}

#[tauri::command]
pub async fn thread_archive(
    state: State<'_, SessionRuntimeState>,
    thread_id: String,
) -> Result<(), String> {
    run_with_facade(&state, move |facade| {
        let _ = facade
            .thread_archive(&thread_id)
            .map_err(|error| error.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn turn_start(
    state: State<'_, SessionRuntimeState>,
    thread_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    personality: Option<String>,
    current_cwd: Option<String>,
    override_cwd: Option<String>,
) -> Result<TurnStartResult, String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("turn/start requires non-empty input text".to_string());
    }

    run_with_facade(&state, move |facade| {
        let payload = facade
            .turn_start(
                &thread_id,
                &trimmed,
                model.as_deref(),
                effort.as_deref(),
                personality.as_deref(),
                override_cwd.as_deref(),
            )
            .map_err(|error| error.to_string())?;
        let resolved_cwd = extract_cwd(&payload)
            .or_else(|| override_cwd.clone())
            .or(current_cwd)
            .ok_or_else(|| "turn/start response did not include cwd".to_string())?;
        Ok(TurnStartResult {
            thread_id,
            turn_id: extract_turn_id(&payload),
            cwd: resolved_cwd,
            workspace_fallback_used: false,
            workspace_warning: None,
        })
    })
    .await
}

#[tauri::command]
pub async fn turn_interrupt(
    state: State<'_, SessionRuntimeState>,
    thread_id: String,
    turn_id: String,
) -> Result<(), String> {
    run_with_facade(&state, move |facade| {
        let _ = facade
            .turn_interrupt(&thread_id, &turn_id)
            .map_err(|error| error.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn approval_respond(
    state: State<'_, SessionRuntimeState>,
    request_id: u64,
    decision: Value,
) -> Result<(), String> {
    if decision.is_null() {
        return Err("approval decision must not be null".to_string());
    }

    run_with_facade(&state, move |facade| {
        facade
            .respond_to_server_request(request_id, json!({ "decision": decision }))
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn diagnostics_drain_stderr(
    state: State<'_, SessionRuntimeState>,
) -> Result<Vec<String>, String> {
    run_with_facade(&state, |facade| {
        facade.drain_stderr().map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn diagnostics_export_logs(
    state: State<'_, SessionRuntimeState>,
) -> Result<DiagnosticsExportResult, String> {
    let (snapshot, home) = run_blocking_task(|| {
        let snapshot = load_snapshot().map_err(|error| error.to_string())?;
        let home = paths::home_dir().map_err(|error| error.to_string())?;
        Ok((snapshot, home))
    })
    .await?;
    let lines = run_with_facade(&state, |facade| {
        facade.drain_stderr().map_err(|error| error.to_string())
    })
    .await?;
    let filtered = filter_diagnostics_lines(&lines, snapshot.config.diagnostics.log_level);
    run_blocking_task(move || {
        write_diagnostics_log(&home, &filtered).map_err(|error| error.to_string())
    })
    .await
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
        extract_cwd, extract_thread_id, extract_turn_id, filter_diagnostics_lines,
        parse_model_list, parse_thread_history_items, parse_thread_list, write_diagnostics_log,
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
    fn extracts_cwd_from_top_level_or_thread_payload() {
        let top_level = json!({ "cwd": "C:/workspace/top" });
        let nested = json!({ "thread": { "cwd": "C:/workspace/thread" } });
        assert_eq!(extract_cwd(&top_level).as_deref(), Some("C:/workspace/top"));
        assert_eq!(extract_cwd(&nested).as_deref(), Some("C:/workspace/thread"));
    }

    #[test]
    fn parses_thread_list_data() {
        let parsed = parse_thread_list(&json!({
            "data": [
                { "id": "thread-a", "name": "Title A", "preview": "alpha" },
                { "id": "thread-b", "preview": "beta" }
            ],
            "nextCursor": "cursor-2"
        }));
        assert_eq!(parsed.threads.len(), 2);
        assert_eq!(parsed.threads[0].id, "thread-a");
        assert_eq!(parsed.threads[0].name.as_deref(), Some("Title A"));
        assert_eq!(parsed.threads[1].preview, "beta");
        assert_eq!(parsed.threads[1].name, None);
        assert_eq!(parsed.next_cursor.as_deref(), Some("cursor-2"));
    }

    #[test]
    fn parses_model_list_data() {
        let parsed = parse_model_list(&json!({
            "data": [
                {
                    "id": "model-a",
                    "model": "gpt-5",
                    "displayName": "GPT-5",
                    "isDefault": true,
                    "defaultReasoningEffort": "medium",
                    "supportedReasoningEfforts": [
                        { "reasoningEffort": "low", "description": "low" },
                        { "reasoningEffort": "medium", "description": "medium" },
                        { "reasoningEffort": "high", "description": "high" }
                    ]
                }
            ]
        }));
        assert_eq!(parsed.models.len(), 1);
        assert_eq!(parsed.models[0].model, "gpt-5");
        assert_eq!(
            parsed.models[0].default_reasoning_effort.as_deref(),
            Some("medium")
        );
        assert_eq!(
            parsed.models[0].supported_reasoning_efforts,
            vec!["low", "medium", "high"]
        );
    }

    #[test]
    fn parses_thread_history_items_from_resume_payload() {
        let parsed = parse_thread_history_items(&json!({
            "thread": {
                "turns": [
                    {
                        "id": "turn-1",
                        "status": "completed",
                        "items": [
                            {
                                "id": "item-user-1",
                                "type": "userMessage",
                                "content": [
                                    { "type": "text", "text": "hello" }
                                ]
                            },
                            {
                                "id": "item-agent-1",
                                "type": "agentMessage",
                                "text": "world"
                            },
                            {
                                "id": "item-plan-1",
                                "type": "plan",
                                "text": "internal plan"
                            },
                            {
                                "id": "item-reasoning-1",
                                "type": "reasoning",
                                "summary": [
                                    "internal reasoning"
                                ]
                            }
                        ]
                    }
                ]
            }
        }));

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].role, "user");
        assert_eq!(parsed[0].text, "hello");
        assert_eq!(parsed[1].role, "agent");
        assert_eq!(parsed[1].text, "world");
        assert!(parsed.iter().all(|item| item.item_type != "plan"));
        assert!(parsed.iter().all(|item| item.item_type != "reasoning"));
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
