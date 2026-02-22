#![allow(dead_code)]

use serde_json::json;

use std::path::Path;

use super::config::{load_or_default, save_system_update, ConfigError, WindowPlacement};
use super::monitor::{intersection_area, primary_monitor, MonitorWorkArea};
use super::paths;
use super::session_runtime::run_blocking_task;

const MIN_WIDTH: u32 = 480;
const MIN_HEIGHT: u32 = 360;
const MIN_THREAD_PANEL_WIDTH: u32 = 220;
const MAX_THREAD_PANEL_WIDTH: u32 = 560;

#[tauri::command]
pub fn window_restore_placement(
    saved: WindowPlacement,
    monitors: Vec<MonitorWorkArea>,
    current_scale_factor: Option<f64>,
) -> WindowPlacement {
    restore_window_placement(saved, &monitors, current_scale_factor)
}

#[tauri::command]
pub async fn window_persist_placement(placement: WindowPlacement) -> Result<(), String> {
    run_blocking_task(move || {
        let config_path = paths::config_file_path().map_err(|error| error.to_string())?;
        persist_window_placement_to_path(&config_path, placement).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn window_read_thread_panel_width() -> Result<Option<u32>, String> {
    run_blocking_task(move || {
        let config_path = paths::config_file_path().map_err(|error| error.to_string())?;
        read_thread_panel_width_from_path(&config_path).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn window_persist_thread_panel_width(width: u32) -> Result<(), String> {
    run_blocking_task(move || {
        let config_path = paths::config_file_path().map_err(|error| error.to_string())?;
        persist_thread_panel_width_to_path(&config_path, width).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn window_read_thread_panel_open() -> Result<Option<bool>, String> {
    run_blocking_task(move || {
        let config_path = paths::config_file_path().map_err(|error| error.to_string())?;
        read_thread_panel_open_from_path(&config_path).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn window_persist_thread_panel_open(open: bool) -> Result<(), String> {
    run_blocking_task(move || {
        let config_path = paths::config_file_path().map_err(|error| error.to_string())?;
        persist_thread_panel_open_to_path(&config_path, open).map_err(|error| error.to_string())
    })
    .await
}

pub fn restore_window_placement(
    mut saved: WindowPlacement,
    monitors: &[MonitorWorkArea],
    current_scale_factor: Option<f64>,
) -> WindowPlacement {
    let Some(primary) = primary_monitor(monitors) else {
        saved.width = saved.width.max(MIN_WIDTH);
        saved.height = saved.height.max(MIN_HEIGHT);
        saved.scale_factor = current_scale_factor;
        return saved;
    };

    let best_monitor = monitors
        .iter()
        .max_by_key(|monitor| {
            intersection_area(saved.x, saved.y, saved.width, saved.height, monitor)
        })
        .unwrap_or(primary);

    let mut target_monitor = best_monitor;
    let visible =
        intersection_area(saved.x, saved.y, saved.width, saved.height, target_monitor) > 0;
    if !visible {
        target_monitor = primary;
    }

    if visible {
        let min_x = target_monitor.x;
        let max_x = target_monitor.x + target_monitor.width as i32 - saved.width as i32;
        let min_y = target_monitor.y;
        let max_y = target_monitor.y + target_monitor.height as i32 - saved.height as i32;
        saved.x = saved.x.clamp(min_x, max_x.max(min_x));
        saved.y = saved.y.clamp(min_y, max_y.max(min_y));
    } else {
        saved.x = target_monitor.x + (target_monitor.width as i32 - saved.width as i32) / 2;
        saved.y = target_monitor.y + (target_monitor.height as i32 - saved.height as i32) / 2;
    }

    saved.scale_factor = current_scale_factor.or(saved.scale_factor);
    saved.extra.insert("restored".to_string(), json!(true));
    saved
}

pub fn persist_window_placement_to_path(
    config_path: &Path,
    placement: WindowPlacement,
) -> Result<(), ConfigError> {
    let mut config = load_or_default(config_path)?;
    config.window.placement = placement;
    save_system_update(config_path, &config)
}

pub fn read_thread_panel_width_from_path(config_path: &Path) -> Result<Option<u32>, ConfigError> {
    let config = load_or_default(config_path)?;
    Ok(config.window.thread_panel_width)
}

pub fn persist_thread_panel_width_to_path(
    config_path: &Path,
    width: u32,
) -> Result<(), ConfigError> {
    let mut config = load_or_default(config_path)?;
    config.window.thread_panel_width = Some(width.clamp(
        MIN_THREAD_PANEL_WIDTH,
        MAX_THREAD_PANEL_WIDTH,
    ));
    save_system_update(config_path, &config)
}

pub fn read_thread_panel_open_from_path(config_path: &Path) -> Result<Option<bool>, ConfigError> {
    let config = load_or_default(config_path)?;
    Ok(config.window.thread_panel_open)
}

pub fn persist_thread_panel_open_to_path(
    config_path: &Path,
    open: bool,
) -> Result<(), ConfigError> {
    let mut config = load_or_default(config_path)?;
    config.window.thread_panel_open = Some(open);
    save_system_update(config_path, &config)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::super::config::{save_system_update, MinicoConfig, WindowPlacement};
    use super::super::monitor::MonitorWorkArea;
    use super::{
        persist_thread_panel_open_to_path, persist_thread_panel_width_to_path,
        persist_window_placement_to_path,
        read_thread_panel_open_from_path, read_thread_panel_width_from_path,
        restore_window_placement,
    };
    use tempfile::TempDir;

    fn primary_monitor() -> MonitorWorkArea {
        MonitorWorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: Some(1.0),
            is_primary: true,
        }
    }

    fn secondary_monitor() -> MonitorWorkArea {
        MonitorWorkArea {
            x: 1920,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: Some(1.0),
            is_primary: false,
        }
    }

    fn placement(x: i32, y: i32, width: u32, height: u32) -> WindowPlacement {
        WindowPlacement {
            x,
            y,
            width,
            height,
            maximized: false,
            scale_factor: Some(1.0),
            extra: HashMap::new(),
        }
    }

    #[test]
    fn recenters_offscreen_window_on_primary_monitor() {
        let saved = placement(9000, 9000, 1200, 900);
        let restored =
            restore_window_placement(saved, &[primary_monitor(), secondary_monitor()], Some(1.0));

        assert!(restored.x >= 0);
        assert!(restored.y >= 0);
        assert_eq!(restored.width, 1200);
        assert_eq!(restored.height, 900);
    }

    #[test]
    fn keeps_window_on_visible_monitor_without_resizing() {
        let saved = placement(1700, 50, 1800, 900);
        let restored =
            restore_window_placement(saved, &[primary_monitor(), secondary_monitor()], Some(1.0));

        assert!(restored.x >= 0);
        assert!(restored.x + restored.width as i32 <= 3840);
        assert_eq!(restored.width, 1800);
        assert_eq!(restored.height, 900);
    }

    #[test]
    fn preserves_saved_size_when_scale_changes() {
        let mut saved = placement(100, 100, 1200, 800);
        saved.scale_factor = Some(2.0);

        let restored = restore_window_placement(saved, &[primary_monitor()], Some(1.0));
        assert_eq!(restored.width, 1200);
        assert_eq!(restored.height, 800);
        assert_eq!(restored.scale_factor, Some(1.0));
    }

    #[test]
    fn preserves_maximized_state() {
        let mut saved = placement(100, 100, 1200, 800);
        saved.maximized = true;

        let restored = restore_window_placement(saved, &[primary_monitor()], Some(1.0));
        assert!(restored.maximized);
    }

    #[test]
    fn persists_window_placement_without_codex_path_validation_blocking() {
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        let mut config = MinicoConfig::default();
        config.codex.path = Some(temp.path().join("missing-codex.exe").display().to_string());
        save_system_update(&config_path, &config).expect("seed config");

        let next = placement(40, 50, 900, 700);
        persist_window_placement_to_path(&config_path, next).expect("persist");
    }

    #[test]
    fn persists_thread_panel_width_without_codex_path_validation_blocking() {
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        let mut config = MinicoConfig::default();
        config.codex.path = Some(temp.path().join("missing-codex.exe").display().to_string());
        save_system_update(&config_path, &config).expect("seed config");

        persist_thread_panel_width_to_path(&config_path, 430).expect("persist");
        let read_back = read_thread_panel_width_from_path(&config_path).expect("read");
        assert_eq!(read_back, Some(430));
    }

    #[test]
    fn persists_thread_panel_open_without_codex_path_validation_blocking() {
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        let mut config = MinicoConfig::default();
        config.codex.path = Some(temp.path().join("missing-codex.exe").display().to_string());
        save_system_update(&config_path, &config).expect("seed config");

        persist_thread_panel_open_to_path(&config_path, false).expect("persist");
        let read_back = read_thread_panel_open_from_path(&config_path).expect("read");
        assert_eq!(read_back, Some(false));
    }
}
