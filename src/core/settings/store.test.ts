import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { loadSettings, saveSettings, validateCodexPath } from "./store";
import type { MinicoConfig, SettingsSnapshot } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("settings store", () => {
  it("loads settings through the backend command", async () => {
    const snapshot: SettingsSnapshot = {
      config: {
        schemaVersion: 1,
        codex: { path: null, homeIsolation: false },
        workspace: { lastPath: null },
        diagnostics: { logLevel: "info" },
        window: {
          placement: { x: 0, y: 0, width: 980, height: 720, maximized: false },
        },
      },
      configPath: "C:/Users/test/.minico/config.json",
      effectiveCodexHome: null,
    };
    mockedInvoke.mockResolvedValueOnce(snapshot);

    await expect(loadSettings()).resolves.toEqual(snapshot);
    expect(mockedInvoke).toHaveBeenCalledWith("settings_read");
  });

  it("saves settings with payload", async () => {
    const config: MinicoConfig = {
      schemaVersion: 1,
      codex: { path: "C:/codex/codex.exe", homeIsolation: true },
      workspace: { lastPath: null },
      diagnostics: { logLevel: "debug" },
      window: {
        placement: { x: 0, y: 0, width: 980, height: 720, maximized: false },
      },
    };
    const response = {
      config,
      configPath: "C:/Users/test/.minico/config.json",
      effectiveCodexHome: "C:/Users/test/.minico/codex",
    };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(saveSettings(config)).resolves.toEqual(response);
    expect(mockedInvoke).toHaveBeenCalledWith("settings_write", { config });
  });

  it("validates codex path through backend command", async () => {
    mockedInvoke.mockResolvedValueOnce({
      valid: false,
      message: "Configured codex path does not exist",
    });

    await expect(validateCodexPath("C:/missing/codex.exe")).resolves.toEqual({
      valid: false,
      message: "Configured codex path does not exist",
    });
    expect(mockedInvoke).toHaveBeenCalledWith("settings_validate_codex_path", {
      path: "C:/missing/codex.exe",
    });
  });
});
