import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disposeWindowPlacementLifecycle,
  initializeWindowPlacementLifecycle,
  loadModelPreferenceRecord,
  loadThreadPanelOpenRecord,
  loadThreadPanelWidthRecord,
  persistModelPreferenceRecord,
  persistThreadPanelOpenRecord,
  persistThreadPanelWidthRecord,
  persistWindowPlacement,
  restoreWindowPlacement,
} from "./windowStateClient";

const invokeMock = vi.fn();
const loadSettingsMock = vi.fn();
const availableMonitorsMock = vi.fn();
const setSizeMock = vi.fn();
const setPositionMock = vi.fn();
const maximizeMock = vi.fn();
const showMock = vi.fn();
const outerPositionMock = vi.fn();
const innerSizeMock = vi.fn();
const isMaximizedMock = vi.fn();
const scaleFactorMock = vi.fn();
const onResizedMock = vi.fn();
const onMovedMock = vi.fn();
const onCloseRequestedMock = vi.fn();
const unlistenResizedMock = vi.fn();
const unlistenMovedMock = vi.fn();
const unlistenCloseRequestedMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: (...args: unknown[]) => availableMonitorsMock(...args),
  getCurrentWindow: () => ({
    setSize: (...args: unknown[]) => setSizeMock(...args),
    setPosition: (...args: unknown[]) => setPositionMock(...args),
    maximize: (...args: unknown[]) => maximizeMock(...args),
    show: (...args: unknown[]) => showMock(...args),
    outerPosition: (...args: unknown[]) => outerPositionMock(...args),
    innerSize: (...args: unknown[]) => innerSizeMock(...args),
    isMaximized: (...args: unknown[]) => isMaximizedMock(...args),
    scaleFactor: (...args: unknown[]) => scaleFactorMock(...args),
    onResized: (...args: unknown[]) => onResizedMock(...args),
    onMoved: (...args: unknown[]) => onMovedMock(...args),
    onCloseRequested: (...args: unknown[]) => onCloseRequestedMock(...args),
  }),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: class PhysicalPosition {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  PhysicalSize: class PhysicalSize {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

vi.mock("../settings/store", () => ({
  loadSettings: (...args: unknown[]) => loadSettingsMock(...args),
}));

describe("windowStateClient", () => {
  afterEach(() => {
    disposeWindowPlacementLifecycle();
  });

  beforeEach(() => {
    disposeWindowPlacementLifecycle();
    invokeMock.mockReset();
    loadSettingsMock.mockReset();
    availableMonitorsMock.mockReset();
    setSizeMock.mockReset();
    setPositionMock.mockReset();
    maximizeMock.mockReset();
    showMock.mockReset();
    outerPositionMock.mockReset();
    innerSizeMock.mockReset();
    isMaximizedMock.mockReset();
    scaleFactorMock.mockReset();
    onResizedMock.mockReset();
    onMovedMock.mockReset();
    onCloseRequestedMock.mockReset();
    unlistenResizedMock.mockReset();
    unlistenMovedMock.mockReset();
    unlistenCloseRequestedMock.mockReset();
    outerPositionMock.mockResolvedValue({ x: 0, y: 0 });
    innerSizeMock.mockResolvedValue({ width: 980, height: 720 });
    isMaximizedMock.mockResolvedValue(false);
    scaleFactorMock.mockResolvedValue(1);
    onResizedMock.mockResolvedValue(unlistenResizedMock);
    onMovedMock.mockResolvedValue(unlistenMovedMock);
    onCloseRequestedMock.mockResolvedValue(unlistenCloseRequestedMock);
  });

  it("calls restore placement command with monitor data", async () => {
    invokeMock.mockResolvedValueOnce({
      x: 40,
      y: 60,
      width: 980,
      height: 720,
      maximized: false,
      scaleFactor: 1,
    });

    const saved = {
      x: 4000,
      y: 3000,
      width: 1200,
      height: 900,
      maximized: false,
      scaleFactor: 2,
    };

    await expect(
      restoreWindowPlacement(
        saved,
        [
          {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scaleFactor: 1,
            isPrimary: true,
          },
        ],
        1,
      ),
    ).resolves.toEqual({
      x: 40,
      y: 60,
      width: 980,
      height: 720,
      maximized: false,
      scaleFactor: 1,
    });

    expect(invokeMock).toHaveBeenCalledWith("window_restore_placement", {
      saved,
      monitors: [
        {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          scaleFactor: 1,
          isPrimary: true,
        },
      ],
      currentScaleFactor: 1,
    });
  });

  it("restores placement on startup lifecycle", async () => {
    loadSettingsMock.mockResolvedValueOnce({
      config: {
        window: {
          placement: {
            x: 100,
            y: 120,
            width: 980,
            height: 720,
            maximized: true,
            scaleFactor: 1,
          },
        },
      },
    });
    availableMonitorsMock.mockResolvedValueOnce([
      {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        workArea: {
          position: { x: 0, y: 40 },
          size: { width: 1920, height: 1040 },
        },
        scaleFactor: 1,
        isPrimary: true,
      },
    ]);
    scaleFactorMock.mockResolvedValueOnce(1);
    invokeMock.mockResolvedValueOnce({
      x: 40,
      y: 60,
      width: 900,
      height: 700,
      maximized: true,
      scaleFactor: 1,
    });

    await initializeWindowPlacementLifecycle();

    expect(invokeMock).toHaveBeenCalledWith("window_restore_placement", {
      saved: {
        x: 100,
        y: 120,
        width: 980,
        height: 720,
        maximized: true,
        scaleFactor: 1,
      },
      monitors: [
        {
          x: 0,
          y: 40,
          width: 1920,
          height: 1040,
          scaleFactor: 1,
          isPrimary: true,
        },
      ],
      currentScaleFactor: 1,
    });
    expect(setSizeMock).toHaveBeenCalledTimes(1);
    expect(setPositionMock).toHaveBeenCalledTimes(1);
    expect(setSizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ width: 900, height: 700 }),
    );
    expect(setPositionMock).toHaveBeenCalledWith(
      expect.objectContaining({ x: 40, y: 60 }),
    );
    expect(maximizeMock).toHaveBeenCalledTimes(1);
    expect(showMock).toHaveBeenCalledTimes(1);
    expect(onResizedMock).toHaveBeenCalledTimes(1);
    expect(onMovedMock).toHaveBeenCalledTimes(1);
    expect(onCloseRequestedMock).toHaveBeenCalledTimes(1);
  });

  it("disposes lifecycle listeners", async () => {
    loadSettingsMock.mockResolvedValueOnce({
      config: {
        window: {
          placement: {
            x: 100,
            y: 120,
            width: 980,
            height: 720,
            maximized: false,
            scaleFactor: 1,
          },
        },
      },
    });
    availableMonitorsMock.mockResolvedValueOnce([
      {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
        isPrimary: true,
      },
    ]);
    scaleFactorMock.mockResolvedValueOnce(1);
    invokeMock.mockResolvedValueOnce({
      x: 100,
      y: 120,
      width: 980,
      height: 720,
      maximized: false,
      scaleFactor: 1,
    });

    await initializeWindowPlacementLifecycle();
    disposeWindowPlacementLifecycle();

    expect(unlistenResizedMock).toHaveBeenCalledTimes(1);
    expect(unlistenMovedMock).toHaveBeenCalledTimes(1);
    expect(unlistenCloseRequestedMock).toHaveBeenCalledTimes(1);
  });

  it("persists current placement through dedicated command", async () => {
    outerPositionMock.mockResolvedValueOnce({ x: 10, y: 20 });
    innerSizeMock.mockResolvedValueOnce({ width: 1000, height: 740 });
    isMaximizedMock.mockResolvedValueOnce(false);
    scaleFactorMock.mockResolvedValueOnce(1.5);
    invokeMock.mockResolvedValueOnce(undefined);

    await persistWindowPlacement();

    expect(invokeMock).toHaveBeenCalledWith("window_persist_placement", {
      placement: {
        x: 10,
        y: 20,
        width: 1000,
        height: 740,
        maximized: false,
        scaleFactor: 1.5,
      },
    });
  });

  it("loads thread panel width from dedicated command", async () => {
    invokeMock.mockResolvedValueOnce(412);
    await expect(loadThreadPanelWidthRecord()).resolves.toBe(412);
    expect(invokeMock).toHaveBeenCalledWith("window_read_thread_panel_width");
  });

  it("persists thread panel width through dedicated command", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(persistThreadPanelWidthRecord(392)).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("window_persist_thread_panel_width", {
      width: 392,
    });
  });

  it("loads thread panel open state from dedicated command", async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(loadThreadPanelOpenRecord()).resolves.toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("window_read_thread_panel_open");
  });

  it("persists thread panel open state through dedicated command", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(persistThreadPanelOpenRecord(true)).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("window_persist_thread_panel_open", {
      open: true,
    });
  });

  it("loads model preference from dedicated command", async () => {
    invokeMock.mockResolvedValueOnce({
      model: "gpt-5.2-codex",
      effort: "high",
    });
    await expect(loadModelPreferenceRecord()).resolves.toEqual({
      model: "gpt-5.2-codex",
      effort: "high",
    });
    expect(invokeMock).toHaveBeenCalledWith("window_read_model_preference");
  });

  it("normalizes blank model preference as null", async () => {
    invokeMock.mockResolvedValueOnce({
      model: "  ",
      effort: "medium",
    });
    await expect(loadModelPreferenceRecord()).resolves.toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("window_read_model_preference");
  });

  it("persists model preference through dedicated command", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(
      persistModelPreferenceRecord("gpt-5.2-codex", "high"),
    ).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("window_persist_model_preference", {
      model: "gpt-5.2-codex",
      effort: "high",
    });
  });
});
