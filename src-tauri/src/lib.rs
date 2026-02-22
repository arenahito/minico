mod core;

#[tauri::command]
fn app_ready_message() -> &'static str {
    "minico bootstrap ready"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(core::config::MinicoConfig::default())
        .invoke_handler(tauri::generate_handler![app_ready_message])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::app_ready_message;

    #[test]
    fn returns_bootstrap_message() {
        assert_eq!(app_ready_message(), "minico bootstrap ready");
    }
}
