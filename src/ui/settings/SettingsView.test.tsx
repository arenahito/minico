import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";
import type { SettingsSnapshot } from "../../core/settings/types";

const loadSettings = vi.fn();
const saveSettings = vi.fn();
const validateCodexPath = vi.fn();

vi.mock("../../core/settings/store", () => ({
  loadSettings: (...args: unknown[]) => loadSettings(...args),
  saveSettings: (...args: unknown[]) => saveSettings(...args),
  validateCodexPath: (...args: unknown[]) => validateCodexPath(...args),
}));

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

describe("SettingsView", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    loadSettings.mockReset();
    saveSettings.mockReset();
    validateCodexPath.mockReset();
    loadSettings.mockResolvedValue(snapshot);
    validateCodexPath.mockResolvedValue({ valid: true, message: null });
    saveSettings.mockResolvedValue(snapshot);
  });

  it("loads settings at mount", async () => {
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });
    expect(loadSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("info")).toBeVisible();
  });

  it("submits updated values", async () => {
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    fireEvent.change(screen.getByLabelText(/Codex executable path/i), {
      target: { value: "C:/tools/codex.exe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(validateCodexPath).toHaveBeenCalledWith("C:/tools/codex.exe");
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });
  });

  it("blocks save when codex path validation fails", async () => {
    validateCodexPath.mockResolvedValueOnce({
      valid: false,
      message: "Configured codex path does not exist",
    });
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    fireEvent.change(screen.getByLabelText(/Codex executable path/i), {
      target: { value: "C:/missing/codex.exe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(validateCodexPath).toHaveBeenCalledWith("C:/missing/codex.exe");
      expect(saveSettings).not.toHaveBeenCalled();
      expect(
        screen.getByText("Configured codex path does not exist"),
      ).toBeVisible();
    });
  });
});
