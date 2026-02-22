import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeWindowPlacementLifecycle,
  persistWindowPlacement,
  restoreWindowPlacement,
} from "./windowStateClient";

const invokeMock = vi.fn();
const loadSettingsMock = vi.fn();
const availableMonitorsMock = vi.fn();
const setSizeMock = vi.fn();
const setPositionMock = vi.fn();
const maximizeMock = vi.fn();
const outerPositionMock = vi.fn();
const outerSizeMock = vi.fn();
const isMaximizedMock = vi.fn();
const scaleFactorMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: (...args: unknown[]) => availableMonitorsMock(...args),
  getCurrentWindow: () => ({
    setSize: (...args: unknown[]) => setSizeMock(...args),
    setPosition: (...args: unknown[]) => setPositionMock(...args),
    maximize: (...args: unknown[]) => maximizeMock(...args),
    outerPosition: (...args: unknown[]) => outerPositionMock(...args),
    outerSize: (...args: unknown[]) => outerSizeMock(...args),
    isMaximized: (...args: unknown[]) => isMaximizedMock(...args),
    scaleFactor: (...args: unknown[]) => scaleFactorMock(...args),
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
  beforeEach(() => {
    invokeMock.mockReset();
    loadSettingsMock.mockReset();
    availableMonitorsMock.mockReset();
    setSizeMock.mockReset();
    setPositionMock.mockReset();
    maximizeMock.mockReset();
    outerPositionMock.mockReset();
    outerSizeMock.mockReset();
    isMaximizedMock.mockReset();
    scaleFactorMock.mockReset();
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
  });

  it("persists current placement through dedicated command", async () => {
    outerPositionMock.mockResolvedValueOnce({ x: 10, y: 20 });
    outerSizeMock.mockResolvedValueOnce({ width: 1000, height: 740 });
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
});
