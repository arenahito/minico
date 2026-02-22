#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorWorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: Option<f64>,
    pub is_primary: bool,
}

pub fn intersection_area(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    monitor: &MonitorWorkArea,
) -> i64 {
    let left = x.max(monitor.x);
    let top = y.max(monitor.y);
    let right = (x + width as i32).min(monitor.x + monitor.width as i32);
    let bottom = (y + height as i32).min(monitor.y + monitor.height as i32);

    let overlap_width = (right - left).max(0) as i64;
    let overlap_height = (bottom - top).max(0) as i64;
    overlap_width * overlap_height
}

pub fn primary_monitor(monitors: &[MonitorWorkArea]) -> Option<&MonitorWorkArea> {
    monitors
        .iter()
        .find(|monitor| monitor.is_primary)
        .or_else(|| monitors.first())
}

#[cfg(test)]
mod tests {
    use super::{intersection_area, primary_monitor, MonitorWorkArea};

    fn primary() -> MonitorWorkArea {
        MonitorWorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: Some(1.0),
            is_primary: true,
        }
    }

    #[test]
    fn calculates_intersection_area() {
        let monitor = primary();
        let area = intersection_area(100, 100, 200, 300, &monitor);
        assert_eq!(area, 60_000);
    }

    #[test]
    fn returns_primary_monitor_when_available() {
        let monitors = [primary()];
        let selected = primary_monitor(&monitors).expect("monitor");
        assert!(selected.is_primary);
    }
}
