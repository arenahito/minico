use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MinicoConfig {
    pub schema_version: u32,
    pub codex: CodexConfig,
    pub window: WindowConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CodexConfig {
    pub path: Option<String>,
    #[serde(rename = "homeIsolation")]
    pub home_isolation: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowConfig {
    pub placement: WindowPlacement,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowPlacement {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

impl Default for MinicoConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            codex: CodexConfig {
                path: None,
                home_isolation: false,
            },
            window: WindowConfig {
                placement: WindowPlacement {
                    x: 120,
                    y: 80,
                    width: 980,
                    height: 720,
                    maximized: false,
                },
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::MinicoConfig;

    #[test]
    fn default_matches_bootstrap_values() {
        let config = MinicoConfig::default();
        assert_eq!(config.schema_version, 1);
        assert_eq!(config.codex.path, None);
        assert!(!config.codex.home_isolation);
        assert_eq!(config.window.placement.width, 980);
    }
}
