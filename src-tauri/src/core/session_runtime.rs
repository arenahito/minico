use std::collections::HashMap;
use std::sync::Mutex;

use tauri::State;

use super::codex_facade::{CodexFacade, RealRuntime};
use super::config::load_snapshot;

pub struct SessionRuntimeState {
    facade: Mutex<Option<CodexFacade<RealRuntime>>>,
}

impl Default for SessionRuntimeState {
    fn default() -> Self {
        Self {
            facade: Mutex::new(None),
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

pub fn with_facade<T>(
    state: &State<'_, SessionRuntimeState>,
    action: impl FnOnce(&mut CodexFacade<RealRuntime>) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .facade
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
