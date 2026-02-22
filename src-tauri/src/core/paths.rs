use std::path::{Path, PathBuf};

use super::config::ConfigError;

pub fn home_dir() -> Result<PathBuf, ConfigError> {
    dirs::home_dir().ok_or(ConfigError::HomeDirNotFound)
}

#[allow(dead_code)]
pub fn minico_dir() -> Result<PathBuf, ConfigError> {
    Ok(minico_dir_from_home(&home_dir()?))
}

pub fn config_file_path() -> Result<PathBuf, ConfigError> {
    Ok(config_file_path_from_home(&home_dir()?))
}

pub fn isolated_codex_home_path() -> Result<PathBuf, ConfigError> {
    Ok(isolated_codex_home_path_from_home(&home_dir()?))
}

pub fn default_workspace_path() -> Result<PathBuf, ConfigError> {
    Ok(default_workspace_path_from_home(&home_dir()?))
}

pub fn minico_dir_from_home(home: &Path) -> PathBuf {
    home.join(".minico")
}

pub fn config_file_path_from_home(home: &Path) -> PathBuf {
    minico_dir_from_home(home).join("config.json")
}

pub fn isolated_codex_home_path_from_home(home: &Path) -> PathBuf {
    minico_dir_from_home(home).join("codex")
}

pub fn default_workspace_path_from_home(home: &Path) -> PathBuf {
    minico_dir_from_home(home).join("workspace")
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{
        config_file_path_from_home, default_workspace_path_from_home,
        isolated_codex_home_path_from_home, minico_dir_from_home,
    };

    #[test]
    fn derives_minico_paths_from_home() {
        let home = Path::new("/tmp/demo");
        assert_eq!(minico_dir_from_home(home), Path::new("/tmp/demo/.minico"));
        assert_eq!(
            config_file_path_from_home(home),
            Path::new("/tmp/demo/.minico/config.json")
        );
        assert_eq!(
            isolated_codex_home_path_from_home(home),
            Path::new("/tmp/demo/.minico/codex")
        );
        assert_eq!(
            default_workspace_path_from_home(home),
            Path::new("/tmp/demo/.minico/workspace")
        );
    }
}
