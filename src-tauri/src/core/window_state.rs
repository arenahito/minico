#![allow(dead_code)]

use serde_json::json;

use std::path::Path;

use super::config::{load_or_default, save_system_update, ConfigError, WindowPlacement};
use super::monitor::{intersection_area, primary_monitor, MonitorWorkArea};
use super::paths;

const MIN_WIDTH: u32 = 480;
const MIN_HEIGHT: u32 = 360;
const MAX_USAGE_RATIO: f64 = 0.95;

#[tauri::command]
pub fn window_restore_placement(
    saved: WindowPlacement,
    monitors: Vec<MonitorWorkArea>,
    current_scale_factor: Option<f64>,
) -> WindowPlacement {
    restore_window_placement(saved, &monitors, current_scale_factor)
}

#[tauri::command]
pub fn window_persist_placement(placement: WindowPlacement) -> Result<(), String> {
    let config_path = paths::config_file_path().map_err(|error| error.to_string())?;
    persist_window_placement_to_path(&config_path, placement).map_err(|error| error.to_string())
}

pub fn restore_window_placement(
    mut saved: WindowPlacement,
    monitors: &[MonitorWorkArea],
    current_scale_factor: Option<f64>,
) -> WindowPlacement {
    if let (Some(saved_scale), Some(current_scale)) = (saved.scale_factor, current_scale_factor) {
        if saved_scale > 0.0 && current_scale > 0.0 {
            let scale_ratio = saved_scale / current_scale;
            saved.width = (saved.width as f64 * scale_ratio).round().max(1.0) as u32;
            saved.height = (saved.height as f64 * scale_ratio).round().max(1.0) as u32;
            saved.x = (saved.x as f64 * scale_ratio).round() as i32;
            saved.y = (saved.y as f64 * scale_ratio).round() as i32;
        }
    }

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

    let max_width = (target_monitor.width as f64 * MAX_USAGE_RATIO).round() as u32;
    let max_height = (target_monitor.height as f64 * MAX_USAGE_RATIO).round() as u32;
    saved.width = saved.width.clamp(MIN_WIDTH, max_width.max(MIN_WIDTH));
    saved.height = saved.height.clamp(MIN_HEIGHT, max_height.max(MIN_HEIGHT));

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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::super::config::{save_system_update, MinicoConfig, WindowPlacement};
    use super::super::monitor::MonitorWorkArea;
    use super::{persist_window_placement_to_path, restore_window_placement};
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
        assert!(restored.width <= 1824);
        assert!(restored.height <= 1026);
    }

    #[test]
    fn keeps_window_on_visible_monitor_with_clamping() {
        let saved = placement(1700, 50, 1800, 900);
        let restored =
            restore_window_placement(saved, &[primary_monitor(), secondary_monitor()], Some(1.0));

        assert!(restored.x >= 0);
        assert!(restored.x + restored.width as i32 <= 3840);
    }

    #[test]
    fn rescales_saved_placement_when_scale_changes() {
        let mut saved = placement(100, 100, 1200, 800);
        saved.scale_factor = Some(2.0);

        let restored = restore_window_placement(saved, &[primary_monitor()], Some(1.0));
        assert_eq!(restored.width, 1824);
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
}
