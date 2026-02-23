use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::paths;
use super::session_runtime::run_blocking_task;

const DEFAULT_CODEX_HOME_ALIAS: &str = "~/.minico/codex";

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Home directory could not be resolved")]
    HomeDirNotFound,
    #[error("Failed to read config file: {0}")]
    ReadConfig(std::io::Error),
    #[error("Failed to write config file: {0}")]
    WriteConfig(std::io::Error),
    #[cfg(unix)]
    #[error("Failed to inspect configured codex path: {0}")]
    PathMetadata(std::io::Error),
    #[error("Failed to parse config file: {0}")]
    Parse(serde_json::Error),
    #[error("Configured codex path does not exist: {0}")]
    CodexPathNotFound(String),
    #[error("Configured codex path is not a file: {0}")]
    CodexPathNotFile(String),
    #[error("Configured codex path is not executable on this platform: {0}")]
    CodexPathNotExecutable(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct MinicoConfig {
    pub schema_version: u32,
    pub codex: CodexConfig,
    pub workspace: WorkspaceConfig,
    pub diagnostics: DiagnosticsConfig,
    pub appearance: AppearanceConfig,
    pub window: WindowConfig,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct CodexConfig {
    pub path: Option<String>,
    pub home_path: Option<String>,
    #[serde(default = "default_codex_personality")]
    pub personality: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    pub last_path: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsConfig {
    pub log_level: LogLevel,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceConfig {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WindowConfig {
    pub placement: WindowPlacement,
    #[serde(rename = "threadPanelWidth")]
    pub thread_panel_width: Option<u32>,
    #[serde(rename = "threadPanelOpen")]
    pub thread_panel_open: Option<bool>,
    #[serde(rename = "selectedModel")]
    pub selected_model: Option<String>,
    #[serde(rename = "selectedEffort")]
    pub selected_effort: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct WindowPlacement {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
    pub scale_factor: Option<f64>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub config: MinicoConfig,
    pub config_path: String,
    pub effective_codex_home: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathValidationResult {
    pub valid: bool,
    pub message: Option<String>,
}

impl Default for MinicoConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            codex: CodexConfig::default(),
            workspace: WorkspaceConfig::default(),
            diagnostics: DiagnosticsConfig::default(),
            appearance: AppearanceConfig::default(),
            window: WindowConfig::default(),
            extra: HashMap::new(),
        }
    }
}

fn default_codex_personality() -> String {
    "friendly".to_string()
}

fn default_theme() -> String {
    "light".to_string()
}

impl Default for CodexConfig {
    fn default() -> Self {
        Self {
            path: None,
            home_path: Some(DEFAULT_CODEX_HOME_ALIAS.to_string()),
            personality: default_codex_personality(),
            extra: HashMap::new(),
        }
    }
}

impl Default for DiagnosticsConfig {
    fn default() -> Self {
        Self {
            log_level: LogLevel::Info,
            extra: HashMap::new(),
        }
    }
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            extra: HashMap::new(),
        }
    }
}

impl Default for WindowPlacement {
    fn default() -> Self {
        Self {
            x: 120,
            y: 80,
            width: 980,
            height: 720,
            maximized: false,
            scale_factor: None,
            extra: HashMap::new(),
        }
    }
}

pub fn load_or_default(config_path: &Path) -> Result<MinicoConfig, ConfigError> {
    if !config_path.exists() {
        return Ok(MinicoConfig::default());
    }

    let raw = fs::read_to_string(config_path).map_err(ConfigError::ReadConfig)?;
    let mut parsed = serde_json::from_str::<MinicoConfig>(&raw).map_err(ConfigError::Parse)?;
    normalize_codex_home_path(&mut parsed);
    Ok(parsed)
}

pub fn save(config_path: &Path, config: &MinicoConfig) -> Result<(), ConfigError> {
    validate_codex_path(config.codex.path.as_deref())?;
    let mut normalized = config.clone();
    normalize_codex_home_path(&mut normalized);
    write_config(config_path, &normalized)
}

pub fn save_system_update(config_path: &Path, config: &MinicoConfig) -> Result<(), ConfigError> {
    let mut normalized = config.clone();
    normalize_codex_home_path(&mut normalized);
    write_config(config_path, &normalized)
}

fn write_config(config_path: &Path, config: &MinicoConfig) -> Result<(), ConfigError> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(ConfigError::WriteConfig)?;
    }

    fs::create_dir_all(resolved_codex_home_path(config)?).map_err(ConfigError::WriteConfig)?;

    let serialized = serde_json::to_string_pretty(config).map_err(ConfigError::Parse)?;
    fs::write(config_path, serialized).map_err(ConfigError::WriteConfig)?;
    Ok(())
}

fn normalize_codex_home_path(config: &mut MinicoConfig) {
    let normalized = config
        .codex
        .home_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_CODEX_HOME_ALIAS);
    config.codex.home_path = Some(normalized.to_string());
}

fn resolve_configured_codex_home_path(raw: &str) -> Result<PathBuf, ConfigError> {
    if raw == "~" {
        return paths::home_dir();
    }
    if let Some(suffix) = raw
        .strip_prefix("~/")
        .or_else(|| raw.strip_prefix("~\\"))
    {
        #[cfg(windows)]
        let normalized_suffix = suffix.replace('/', "\\");
        #[cfg(not(windows))]
        let normalized_suffix = suffix.replace('\\', "/");
        return Ok(paths::home_dir()?.join(normalized_suffix));
    }
    Ok(PathBuf::from(raw))
}

fn resolved_codex_home_path(config: &MinicoConfig) -> Result<PathBuf, ConfigError> {
    let configured_path = config
        .codex
        .home_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(path) = configured_path {
        return resolve_configured_codex_home_path(path);
    }
    paths::default_codex_home_path()
}

pub fn validate_codex_path(path: Option<&str>) -> Result<(), ConfigError> {
    let Some(raw_path) = path else {
        return Ok(());
    };

    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let candidate = PathBuf::from(trimmed);
    if !candidate.exists() {
        return Err(ConfigError::CodexPathNotFound(trimmed.to_string()));
    }
    if !candidate.is_file() {
        return Err(ConfigError::CodexPathNotFile(trimmed.to_string()));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mode = fs::metadata(&candidate)
            .map_err(ConfigError::PathMetadata)?
            .permissions()
            .mode();
        if mode & 0o111 == 0 {
            return Err(ConfigError::CodexPathNotExecutable(trimmed.to_string()));
        }
    }

    #[cfg(windows)]
    {
        let extension = candidate
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let executable = matches!(extension.as_str(), "exe" | "cmd" | "bat" | "com");
        if !executable {
            return Err(ConfigError::CodexPathNotExecutable(trimmed.to_string()));
        }
    }

    Ok(())
}

pub fn effective_codex_home(config: &MinicoConfig) -> Result<Option<String>, ConfigError> {
    let path = resolved_codex_home_path(config)?;
    Ok(Some(path.display().to_string()))
}

pub fn load_snapshot() -> Result<SettingsSnapshot, ConfigError> {
    let config_path = paths::config_file_path()?;
    let config = load_or_default(&config_path)?;
    let effective_codex_home = effective_codex_home(&config)?;
    Ok(SettingsSnapshot {
        config,
        config_path: config_path.display().to_string(),
        effective_codex_home,
    })
}

#[tauri::command]
pub async fn settings_read() -> Result<SettingsSnapshot, String> {
    run_blocking_task(|| load_snapshot().map_err(|error| error.to_string())).await
}

#[tauri::command]
pub async fn settings_write(config: MinicoConfig) -> Result<SettingsSnapshot, String> {
    run_blocking_task(move || {
        let config_path = paths::config_file_path().map_err(|error| error.to_string())?;
        save(&config_path, &config).map_err(|error| error.to_string())?;
        load_snapshot().map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn settings_validate_codex_path(
    path: Option<String>,
) -> Result<PathValidationResult, String> {
    run_blocking_task(move || match validate_codex_path(path.as_deref()) {
        Ok(()) => Ok(PathValidationResult {
            valid: true,
            message: None,
        }),
        Err(error) => Ok(PathValidationResult {
            valid: false,
            message: Some(error.to_string()),
        }),
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::{
        effective_codex_home, load_or_default, save, save_system_update, validate_codex_path,
        ConfigError, LogLevel, MinicoConfig,
    };

    #[test]
    fn default_matches_bootstrap_values() {
        let config = MinicoConfig::default();
        assert_eq!(config.schema_version, 1);
        assert_eq!(config.codex.path, None);
        assert_eq!(config.codex.home_path.as_deref(), Some("~/.minico/codex"));
        assert_eq!(config.codex.personality, "friendly");
        assert_eq!(config.workspace.last_path, None);
        assert_eq!(config.diagnostics.log_level, LogLevel::Info);
        assert_eq!(config.appearance.theme, "light");
        assert_eq!(config.window.placement.width, 980);
        assert_eq!(config.window.thread_panel_width, None);
        assert_eq!(config.window.thread_panel_open, None);
        assert!(config.extra.is_empty());
    }

    #[test]
    fn deserialization_preserves_unknown_fields_on_roundtrip() {
        let raw = r#"
        {
            "schemaVersion": 1,
            "codex": { "path": null, "homePath": null, "futureKey": true },
            "workspace": { "lastPath": null },
            "diagnostics": { "logLevel": "debug" },
            "window": { "placement": { "x": 1, "y": 2, "width": 640, "height": 480, "maximized": false } },
            "unknownRoot": "keep-forward-compatible"
        }
        "#;
        let parsed: MinicoConfig = serde_json::from_str(raw).expect("parse should succeed");
        assert_eq!(parsed.codex.home_path, None);
        assert_eq!(
            parsed.extra.get("unknownRoot"),
            Some(&serde_json::Value::String(
                "keep-forward-compatible".to_string()
            ))
        );
        assert_eq!(
            parsed.codex.extra.get("futureKey"),
            Some(&serde_json::Value::Bool(true))
        );
        assert_eq!(parsed.codex.personality, "friendly");
        assert_eq!(parsed.appearance.theme, "light");

        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("roundtrip.json");
        save(&config_path, &parsed).expect("save should preserve unknown fields");
        let written = fs::read_to_string(config_path).expect("saved config");
        assert!(written.contains("\"unknownRoot\": \"keep-forward-compatible\""));
        assert!(written.contains("\"futureKey\": true"));

        assert_eq!(parsed.diagnostics.log_level, LogLevel::Debug);
        assert_eq!(parsed.window.placement.width, 640);
    }

    #[test]
    fn save_rejects_missing_codex_path() {
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        let mut config = MinicoConfig::default();
        config.codex.path = Some(temp.path().join("missing.exe").display().to_string());

        let error = save(&config_path, &config).expect_err("missing codex path must fail");
        assert!(matches!(error, ConfigError::CodexPathNotFound(_)));
    }

    #[test]
    fn system_update_save_skips_codex_path_validation() {
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        let mut config = MinicoConfig::default();
        config.codex.path = Some(temp.path().join("missing.exe").display().to_string());

        save_system_update(&config_path, &config).expect("internal save should succeed");
        let written = fs::read_to_string(config_path).expect("saved config");
        assert!(written.contains("missing.exe"));
    }

    #[test]
    fn save_writes_json_when_codex_path_is_not_set() {
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        let config = MinicoConfig::default();

        save(&config_path, &config).expect("save should work");
        let written = fs::read_to_string(config_path).expect("saved config");
        assert!(written.contains("\"schemaVersion\": 1"));
    }

    #[test]
    fn load_returns_persisted_config() {
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        let mut config = MinicoConfig::default();
        config.workspace.last_path = Some("C:/workspace/demo".to_string());
        config.diagnostics.log_level = LogLevel::Debug;

        save(&config_path, &config).expect("save should work");
        let loaded = load_or_default(&config_path).expect("load should work");
        assert_eq!(
            loaded.workspace.last_path,
            Some("C:/workspace/demo".to_string())
        );
        assert_eq!(loaded.diagnostics.log_level, LogLevel::Debug);
    }

    #[test]
    fn effective_codex_home_uses_default_or_custom_path() {
        let config = MinicoConfig::default();
        let default_home = effective_codex_home(&config).expect("value when defaulting");
        assert!(default_home.is_some());
        let default_path = default_home.expect("default codex home path");
        let normalized_default_path = default_path.replace('\\', "/");
        assert!(normalized_default_path.ends_with(".minico/codex"));

        let mut custom_config = config;
        custom_config.codex.home_path = Some("C:/custom/codex-home".to_string());
        let custom = effective_codex_home(&custom_config).expect("value when custom");
        assert_eq!(custom.as_deref(), Some("C:/custom/codex-home"));
    }

    #[test]
    fn load_normalizes_null_codex_home_to_default_alias() {
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        fs::write(
            &config_path,
            r#"{
                "schemaVersion": 1,
                "codex": { "path": null, "homePath": null, "personality": "friendly" },
                "workspace": { "lastPath": null },
                "diagnostics": { "logLevel": "info" },
                "appearance": { "theme": "light" },
                "window": { "placement": { "x": 0, "y": 0, "width": 980, "height": 720, "maximized": false } }
            }"#,
        )
        .expect("write config");

        let loaded = load_or_default(&config_path).expect("load should work");
        assert_eq!(loaded.codex.home_path.as_deref(), Some("~/.minico/codex"));
    }

    #[test]
    fn empty_codex_path_is_treated_as_unset() {
        assert!(validate_codex_path(Some("  ")).is_ok());
    }
}
