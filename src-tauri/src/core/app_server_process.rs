#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppServerCommand {
    pub executable: String,
    pub args: Vec<String>,
}

impl AppServerCommand {
    #[allow(dead_code)]
    pub fn from_codex_path(codex_path: Option<&str>) -> Self {
        let executable = codex_path.unwrap_or("codex").to_string();
        Self {
            executable,
            args: vec!["app-server".to_string()],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AppServerCommand;

    #[test]
    fn uses_path_lookup_when_codex_path_is_missing() {
        let command = AppServerCommand::from_codex_path(None);
        assert_eq!(command.executable, "codex");
        assert_eq!(command.args, vec!["app-server"]);
    }

    #[test]
    fn uses_explicit_codex_path_when_provided() {
        let command = AppServerCommand::from_codex_path(Some("C:\\codex\\codex.exe"));
        assert_eq!(command.executable, "C:\\codex\\codex.exe");
        assert_eq!(command.args, vec!["app-server"]);
    }
}
