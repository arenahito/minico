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
const loadDefaultWorkspacePath = vi.fn();
const resolveActiveCwd = vi.fn();
const exportDiagnosticsLogs = vi.fn();

vi.mock("../../core/settings/store", () => ({
  loadSettings: (...args: unknown[]) => loadSettings(...args),
  saveSettings: (...args: unknown[]) => saveSettings(...args),
  validateCodexPath: (...args: unknown[]) => validateCodexPath(...args),
}));

vi.mock("../../core/workspace/workspaceStore", () => ({
  loadDefaultWorkspacePath: (...args: unknown[]) =>
    loadDefaultWorkspacePath(...args),
  resolveActiveCwd: (...args: unknown[]) => resolveActiveCwd(...args),
}));

vi.mock("../../core/diagnostics/client", () => ({
  exportDiagnosticsLogs: (...args: unknown[]) => exportDiagnosticsLogs(...args),
}));

const snapshot: SettingsSnapshot = {
  config: {
    schemaVersion: 1,
    codex: { path: null, homeIsolation: false, personality: "friendly" },
    workspace: { lastPath: null },
    diagnostics: { logLevel: "info" },
    appearance: { theme: "light" },
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
    loadDefaultWorkspacePath.mockResolvedValue("C:/Users/test/.minico/workspace");
    resolveActiveCwd.mockResolvedValue({
      cwd: "C:/Users/test/.minico/workspace",
      fallbackUsed: false,
      warning: null,
    });
    validateCodexPath.mockResolvedValue({ valid: true, message: null });
    saveSettings.mockResolvedValue(snapshot);
    exportDiagnosticsLogs.mockResolvedValue({
      logPath: "C:/Users/test/.minico/logs/diagnostics.log",
      lineCount: 0,
    });
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

  it("saves selected codex personality", async () => {
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    fireEvent.change(screen.getByLabelText(/Codex personality/i), {
      target: { value: "pragmatic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    const savedConfig = saveSettings.mock.calls[0]?.[0];
    expect(savedConfig.codex.personality).toBe("pragmatic");
  });

  it("saves selected theme", async () => {
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    fireEvent.change(screen.getByLabelText(/^Theme$/i), {
      target: { value: "dark" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    const savedConfig = saveSettings.mock.calls[0]?.[0];
    expect(savedConfig.appearance.theme).toBe("dark");
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

  it("shows fallback warning from workspace resolver", async () => {
    resolveActiveCwd.mockResolvedValueOnce({
      cwd: "C:/Users/test/.minico/workspace",
      fallbackUsed: true,
      warning: "Stored workspace path was unavailable. Fallback to default workspace.",
    });
    render(<SettingsView />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Stored workspace path was unavailable. Fallback to default workspace.",
        ),
      ).toBeVisible();
    });
  });

  it("uses resolved workspace path after fallback when saving", async () => {
    loadSettings.mockResolvedValueOnce({
      ...snapshot,
      config: {
        ...snapshot.config,
        workspace: { lastPath: "C:/missing/workspace" },
      },
    });
    resolveActiveCwd.mockResolvedValueOnce({
      cwd: "C:/Users/test/.minico/workspace",
      fallbackUsed: true,
      warning: "Stored workspace path was unavailable. Fallback to default workspace.",
    });
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    const savedConfig = saveSettings.mock.calls[0]?.[0];
    expect(savedConfig.workspace.lastPath).toBe("C:/Users/test/.minico/workspace");
  });

  it("exports diagnostics log path", async () => {
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }));

    await waitFor(() => {
      expect(exportDiagnosticsLogs).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Diagnostics log exported:/)).toBeVisible();
    });
  });
});
