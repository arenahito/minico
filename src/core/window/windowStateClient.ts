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

export interface ModelPreferenceRecord {
  model: string | null;
  effort: string | null;
}

let disposeLifecycleListeners: (() => void) | null = null;
let lastPersistedPlacementKey: string | null = null;
let lifecycleGeneration = 0;

function teardownLifecycleListeners(): void {
  if (!disposeLifecycleListeners) {
    return;
  }
  disposeLifecycleListeners();
  disposeLifecycleListeners = null;
}

function placementKey(placement: WindowPlacement): string {
  return [
    placement.x,
    placement.y,
    placement.width,
    placement.height,
    placement.maximized ? 1 : 0,
    placement.scaleFactor ?? "none",
  ].join("|");
}

async function readCurrentWindowPlacementRecord(): Promise<WindowPlacement> {
  const appWindow = getCurrentWindow();
  const [position, size, maximized, scaleFactor] = await Promise.all([
    appWindow.outerPosition(),
    appWindow.innerSize(),
    appWindow.isMaximized(),
    appWindow.scaleFactor(),
  ]);
  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    maximized,
    scaleFactor,
  };
}

async function persistWindowPlacementIfChanged(force = false): Promise<void> {
  const next = await readCurrentWindowPlacementRecord();
  const key = placementKey(next);
  if (!force && key === lastPersistedPlacementKey) {
    return;
  }
  await persistWindowPlacementRecord(next);
  lastPersistedPlacementKey = key;
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

export async function loadThreadPanelWidthRecord(): Promise<number | null> {
  const value = await invoke<number | null>("window_read_thread_panel_width");
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

export async function persistThreadPanelWidthRecord(width: number): Promise<void> {
  await invoke("window_persist_thread_panel_width", { width });
}

export async function loadThreadPanelOpenRecord(): Promise<boolean | null> {
  const value = await invoke<boolean | null>("window_read_thread_panel_open");
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

export async function persistThreadPanelOpenRecord(open: boolean): Promise<void> {
  await invoke("window_persist_thread_panel_open", { open });
}

export async function loadModelPreferenceRecord(): Promise<ModelPreferenceRecord | null> {
  const value = await invoke<ModelPreferenceRecord | null>("window_read_model_preference");
  if (!value || typeof value !== "object") {
    return null;
  }
  const model =
    typeof value.model === "string" && value.model.trim().length > 0
      ? value.model.trim()
      : null;
  const effort =
    typeof value.effort === "string" && value.effort.trim().length > 0
      ? value.effort.trim()
      : null;
  if (!model) {
    return null;
  }
  return { model, effort };
}

export async function persistModelPreferenceRecord(
  model: string | null,
  effort: string | null,
): Promise<void> {
  await invoke("window_persist_model_preference", {
    model: model?.trim() || null,
    effort: effort?.trim() || null,
  });
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
  const appWindow = getCurrentWindow();
  const generation = ++lifecycleGeneration;
  teardownLifecycleListeners();
  try {
    const snapshot = await loadSettings();
    if (generation !== lifecycleGeneration) {
      return;
    }
    lastPersistedPlacementKey = placementKey(snapshot.config.window.placement);
    const monitorsRaw = await availableMonitors();
    if (generation !== lifecycleGeneration) {
      return;
    }
    const monitors = monitorsRaw.map(toMonitorWorkArea);
    const currentScaleFactor = await appWindow.scaleFactor();
    if (generation !== lifecycleGeneration) {
      return;
    }
    let pendingPersistTimer: number | null = null;
    const schedulePersist = () => {
      if (pendingPersistTimer !== null) {
        window.clearTimeout(pendingPersistTimer);
      }
      pendingPersistTimer = window.setTimeout(() => {
        pendingPersistTimer = null;
        void persistWindowPlacementIfChanged(false);
      }, 240);
    };

    const [unlistenResized, unlistenMoved, unlistenCloseRequested] = await Promise.all([
      appWindow.onResized(() => {
        schedulePersist();
      }),
      appWindow.onMoved(() => {
        schedulePersist();
      }),
      appWindow.onCloseRequested(() => {
        void persistWindowPlacementIfChanged(true);
      }),
    ]);
    if (generation !== lifecycleGeneration) {
      unlistenResized();
      unlistenMoved();
      unlistenCloseRequested();
      return;
    }

    disposeLifecycleListeners = () => {
      if (pendingPersistTimer !== null) {
        window.clearTimeout(pendingPersistTimer);
        pendingPersistTimer = null;
      }
      unlistenResized();
      unlistenMoved();
      unlistenCloseRequested();
    };

    const restored = await restoreWindowPlacement(
      snapshot.config.window.placement,
      monitors,
      currentScaleFactor,
    );
    if (generation !== lifecycleGeneration) {
      return;
    }
    try {
      await appWindow.setSize(new PhysicalSize(restored.width, restored.height));
      await appWindow.setPosition(new PhysicalPosition(restored.x, restored.y));
      if (restored.maximized) {
        await appWindow.maximize();
      }
      const applied = await readCurrentWindowPlacementRecord();
      lastPersistedPlacementKey = placementKey(applied);
    } catch (error) {
      console.warn("window placement restore apply failed", error);
    }
  } catch (error) {
    if (generation === lifecycleGeneration) {
      console.warn("window placement lifecycle initialization failed", error);
    }
  }

  if (generation !== lifecycleGeneration) {
    return;
  }

  try {
    await appWindow.show();
  } catch (error) {
    console.warn("window show failed", error);
  }
}

export function disposeWindowPlacementLifecycle(): void {
  lifecycleGeneration += 1;
  teardownLifecycleListeners();
}

export async function persistWindowPlacement(): Promise<void> {
  try {
    await persistWindowPlacementIfChanged(true);
  } catch (error) {
    console.warn("window placement persist failed", error);
    return;
  }
}
