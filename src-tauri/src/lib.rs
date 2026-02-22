mod core;
use crate::core::session_runtime::SessionRuntimeState;

#[tauri::command]
fn app_ready_message() -> &'static str {
    "minico bootstrap ready"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SessionRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            app_ready_message,
            core::config::settings_read,
            core::config::settings_write,
            core::config::settings_validate_codex_path,
            core::workspace::workspace_default_path,
            core::workspace::workspace_resolve_active_cwd,
            core::window_state::window_restore_placement,
            core::window_state::window_persist_placement,
            core::window_state::window_read_thread_panel_width,
            core::window_state::window_persist_thread_panel_width,
            core::window_state::window_read_thread_panel_open,
            core::window_state::window_persist_thread_panel_open,
            core::window_state::window_read_model_preference,
            core::window_state::window_persist_model_preference,
            core::auth::auth_read_status,
            core::auth::auth_login_start_chatgpt,
            core::auth::auth_logout_and_read,
            core::thread_turn::session_poll_events,
            core::thread_turn::model_list,
            core::thread_turn::thread_list,
            core::thread_turn::thread_start,
            core::thread_turn::thread_resume,
            core::thread_turn::turn_start,
            core::thread_turn::turn_interrupt,
            core::thread_turn::approval_respond,
            core::thread_turn::diagnostics_drain_stderr,
            core::thread_turn::diagnostics_export_logs
        ])
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
