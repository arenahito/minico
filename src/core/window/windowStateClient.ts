import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";

import { loadSettings } from "../settings/store";
import type { WindowPlacement } from "../settings/types";

export interface MonitorWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor?: number | null;
  isPrimary: boolean;
}

export async function restoreWindowPlacement(
  saved: WindowPlacement,
  monitors: MonitorWorkArea[],
  currentScaleFactor: number | null,
): Promise<WindowPlacement> {
  return invoke<WindowPlacement>("window_restore_placement", {
    saved,
    monitors,
    currentScaleFactor,
  });
}

export async function persistWindowPlacementRecord(
  placement: WindowPlacement,
): Promise<void> {
  await invoke("window_persist_placement", { placement });
}

function toMonitorWorkArea(monitor: {
  position: { x: number; y: number };
  size: { width: number; height: number };
  workArea?: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  };
  scaleFactor?: number;
  isPrimary?: boolean;
}): MonitorWorkArea {
  const areaPosition = monitor.workArea?.position ?? monitor.position;
  const areaSize = monitor.workArea?.size ?? monitor.size;

  return {
    x: areaPosition.x,
    y: areaPosition.y,
    width: areaSize.width,
    height: areaSize.height,
    scaleFactor: monitor.scaleFactor ?? null,
    isPrimary: monitor.isPrimary ?? false,
  };
}

export async function initializeWindowPlacementLifecycle(): Promise<void> {
  try {
    const snapshot = await loadSettings();
    const appWindow = getCurrentWindow();
    const monitorsRaw = await availableMonitors();
    const monitors = monitorsRaw.map(toMonitorWorkArea);
    const currentScaleFactor = await appWindow.scaleFactor();
    const restored = await restoreWindowPlacement(
      snapshot.config.window.placement,
      monitors,
      currentScaleFactor,
    );

    await appWindow.setSize(new PhysicalSize(restored.width, restored.height));
    await appWindow.setPosition(new PhysicalPosition(restored.x, restored.y));
    if (restored.maximized) {
      await appWindow.maximize();
    }
  } catch {
    return;
  }
}

export async function persistWindowPlacement(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    const position = await appWindow.outerPosition();
    const size = await appWindow.outerSize();
    const maximized = await appWindow.isMaximized();
    const scaleFactor = await appWindow.scaleFactor();

    await persistWindowPlacementRecord({
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      maximized,
      scaleFactor,
    });
  } catch {
    return;
  }
}
