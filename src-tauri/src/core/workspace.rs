use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::config::{load_or_default, save_system_update, ConfigError, MinicoConfig};
use super::paths;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResolution {
    pub cwd: String,
    pub fallback_used: bool,
    pub warning: Option<String>,
}

fn has_read_write_access(path: &Path) -> bool {
    if fs::read_dir(path).is_err() {
        return false;
    }

    let probe = path.join(".minico-write-probe");
    let write_result = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&probe)
        .and_then(|mut file| file.write_all(b"probe"));

    if write_result.is_err() {
        return false;
    }

    let _ = fs::remove_file(probe);
    true
}

fn is_usable_workspace(path: &Path) -> bool {
    path.is_dir() && has_read_write_access(path)
}

fn ensure_default_workspace(home: &Path) -> Result<PathBuf, ConfigError> {
    let default_path = paths::default_workspace_path_from_home(home);
    fs::create_dir_all(&default_path).map_err(ConfigError::WriteConfig)?;
    Ok(default_path)
}

pub fn resolve_active_cwd_for_home(
    config: &mut MinicoConfig,
    home: &Path,
) -> Result<WorkspaceResolution, ConfigError> {
    let had_selected_workspace = config
        .workspace
        .last_path
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());

    if let Some(selected_raw) = config.workspace.last_path.as_deref() {
        let selected = PathBuf::from(selected_raw);
        if is_usable_workspace(&selected) {
            return Ok(WorkspaceResolution {
                cwd: selected.display().to_string(),
                fallback_used: false,
                warning: None,
            });
        }
    }

    let default_path = ensure_default_workspace(home)?;
    config.workspace.last_path = Some(default_path.display().to_string());
    Ok(WorkspaceResolution {
        cwd: default_path.display().to_string(),
        fallback_used: true,
        warning: had_selected_workspace.then(|| {
            "Stored workspace path was unavailable. Fallback to default workspace.".to_string()
        }),
    })
}

#[tauri::command]
pub fn workspace_default_path() -> Result<String, String> {
    let path = paths::default_workspace_path().map_err(|error| error.to_string())?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn workspace_resolve_active_cwd() -> Result<WorkspaceResolution, String> {
    let config_path = paths::config_file_path().map_err(|error| error.to_string())?;
    let mut config = load_or_default(&config_path).map_err(|error| error.to_string())?;
    let home = paths::home_dir().map_err(|error| error.to_string())?;
    let resolution =
        resolve_active_cwd_for_home(&mut config, &home).map_err(|error| error.to_string())?;

    if resolution.fallback_used {
        save_system_update(&config_path, &config).map_err(|error| error.to_string())?;
    }

    Ok(resolution)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::resolve_active_cwd_for_home;
    use crate::core::config::MinicoConfig;

    #[test]
    fn uses_selected_workspace_when_available() {
        let home = TempDir::new().expect("temp home");
        let selected = home.path().join("project");
        fs::create_dir_all(&selected).expect("create workspace");

        let mut config = MinicoConfig::default();
        config.workspace.last_path = Some(selected.display().to_string());
        let resolved = resolve_active_cwd_for_home(&mut config, home.path()).expect("resolved");

        assert_eq!(resolved.cwd, selected.display().to_string());
        assert!(!resolved.fallback_used);
        assert_eq!(resolved.warning, None);
    }

    #[test]
    fn falls_back_to_default_when_selected_workspace_is_missing() {
        let home = TempDir::new().expect("temp home");
        let missing = home.path().join("missing-workspace");

        let mut config = MinicoConfig::default();
        config.workspace.last_path = Some(missing.display().to_string());
        let resolved = resolve_active_cwd_for_home(&mut config, home.path()).expect("resolved");

        let expected = home.path().join(".minico").join("workspace");
        assert_eq!(resolved.cwd, expected.display().to_string());
        assert!(resolved.fallback_used);
        assert!(resolved.warning.is_some());
        assert_eq!(
            config.workspace.last_path,
            Some(expected.display().to_string())
        );
    }

    #[test]
    fn creates_default_workspace_when_no_selection_exists() {
        let home = TempDir::new().expect("temp home");
        let mut config = MinicoConfig::default();

        let resolved = resolve_active_cwd_for_home(&mut config, home.path()).expect("resolved");
        let expected = home.path().join(".minico").join("workspace");
        assert_eq!(resolved.cwd, expected.display().to_string());
        assert!(expected.is_dir());
        assert!(resolved.fallback_used);
        assert_eq!(resolved.warning, None);
    }

    #[test]
    fn resolves_workspace_even_when_codex_path_is_invalid() {
        let home = TempDir::new().expect("temp home");
        let mut config = MinicoConfig::default();
        config.codex.path = Some(home.path().join("missing-codex.exe").display().to_string());
        config.workspace.last_path =
            Some(home.path().join("missing-workspace").display().to_string());

        let resolved = resolve_active_cwd_for_home(&mut config, home.path()).expect("resolved");
        assert!(
            resolved.cwd.ends_with(".minico\\workspace")
                || resolved.cwd.ends_with(".minico/workspace")
        );
        assert!(resolved.fallback_used);
    }
}
