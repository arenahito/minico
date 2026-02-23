use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::State;

use super::codex_facade::{CodexFacade, RealRuntime};
use super::config::load_snapshot;

pub struct SessionRuntimeState {
    facade: Arc<Mutex<Option<CodexFacade<RealRuntime>>>>,
}

impl Default for SessionRuntimeState {
    fn default() -> Self {
        Self {
            facade: Arc::new(Mutex::new(None)),
        }
    }
}

fn create_facade() -> Result<CodexFacade<RealRuntime>, String> {
    let snapshot = load_snapshot().map_err(|error| error.to_string())?;
    let mut env_vars = HashMap::new();
    if let Some(codex_home) = snapshot.effective_codex_home {
        env_vars.insert("CODEX_HOME".to_string(), codex_home);
    }

    let runtime = RealRuntime::new(snapshot.config.codex.path, env_vars)
        .map_err(|error| error.to_string())?;
    let mut facade = CodexFacade::new(runtime, env!("CARGO_PKG_VERSION"));
    facade.initialize().map_err(|error| error.to_string())?;
    Ok(facade)
}

pub async fn run_blocking_task<T>(
    action: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|error| format!("blocking task join failed: {error}"))?
}

pub async fn run_with_facade<T>(
    state: &State<'_, SessionRuntimeState>,
    action: impl FnOnce(&mut CodexFacade<RealRuntime>) -> Result<T, String> + Send + 'static,
) -> Result<T, String>
where
    T: Send + 'static,
{
    let slot = facade_slot(state);
    run_blocking_task(move || with_facade_slot(&slot, action)).await
}

pub fn facade_slot(
    state: &State<'_, SessionRuntimeState>,
) -> Arc<Mutex<Option<CodexFacade<RealRuntime>>>> {
    Arc::clone(&state.facade)
}

pub fn with_facade_slot<T>(
    slot: &Arc<Mutex<Option<CodexFacade<RealRuntime>>>>,
    action: impl FnOnce(&mut CodexFacade<RealRuntime>) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = slot
        .lock()
        .map_err(|_| "session runtime lock poisoned".to_string())?;
    if guard.is_none() {
        *guard = Some(create_facade()?);
    }

    let facade = guard
        .as_mut()
        .ok_or_else(|| "session runtime was not initialized".to_string())?;
    action(facade)
}

#[tauri::command]
pub async fn session_reset_runtime(state: State<'_, SessionRuntimeState>) -> Result<(), String> {
    let slot = facade_slot(&state);
    run_blocking_task(move || {
        let mut guard = slot
            .lock()
            .map_err(|_| "session runtime lock poisoned".to_string())?;
        if let Some(mut facade) = guard.take() {
            let _ = facade.shutdown();
        }
        Ok(())
    })
    .await
}
