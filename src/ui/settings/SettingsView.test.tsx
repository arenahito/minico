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
const openDialog = vi.fn();

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

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialog(...args),
}));

const snapshot: SettingsSnapshot = {
  config: {
    schemaVersion: 1,
    codex: { path: null, homePath: "~/.codex", personality: "friendly" },
    workspace: { lastPath: null },
    diagnostics: { logLevel: "info" },
    appearance: { theme: "light" },
    window: {
      placement: { x: 0, y: 0, width: 980, height: 720, maximized: false },
    },
  },
  configPath: "C:/Users/test/.minico/config.json",
  effectiveCodexHome: "C:/Users/test/.codex",
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
    saveSettings.mockImplementation(async (config) => ({
      ...snapshot,
      config,
      effectiveCodexHome: config.codex.homePath?.startsWith("~")
        ? "C:/Users/test/.codex"
        : (config.codex.homePath ?? "C:/Users/test/.codex"),
    }));
    exportDiagnosticsLogs.mockResolvedValue({
      logPath: "C:/Users/test/.minico/logs/diagnostics.log",
      lineCount: 0,
    });
    openDialog.mockReset();
  });

  it("loads settings at mount", async () => {
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });
    expect(loadSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("info")).toBeVisible();
    expect(screen.getByDisplayValue("C:/Users/test/.codex")).toBeVisible();
  });

  it("saves updated text values on blur", async () => {
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    const codexPathInput = screen.getByLabelText(/Codex executable path/i);
    fireEvent.change(codexPathInput, {
      target: { value: "C:/tools/codex.exe" },
    });
    fireEvent.blur(codexPathInput);

    const codexHomeInput = screen.getByLabelText(/^CODEX_HOME$/i);
    fireEvent.change(codexHomeInput, {
      target: { value: "C:/users/test/custom-codex-home" },
    });
    fireEvent.blur(codexHomeInput);

    await waitFor(() => {
      expect(validateCodexPath).toHaveBeenCalledWith("C:/tools/codex.exe");
      expect(saveSettings).toHaveBeenCalledTimes(2);
      const savedConfig = saveSettings.mock.calls[1]?.[0];
      expect(savedConfig.codex.homePath).toBe("C:/users/test/custom-codex-home");
    });
  });

  it("saves selected codex personality immediately", async () => {
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    fireEvent.change(screen.getByLabelText(/Codex personality/i), {
      target: { value: "pragmatic" },
    });
    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    const savedConfig = saveSettings.mock.calls[0]?.[0];
    expect(savedConfig.codex.personality).toBe("pragmatic");
  });

  it("saves selected theme immediately", async () => {
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    fireEvent.change(screen.getByLabelText(/^Theme$/i), {
      target: { value: "dark" },
    });
    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    const savedConfig = saveSettings.mock.calls[0]?.[0];
    expect(savedConfig.appearance.theme).toBe("dark");
  });

  it("blocks save when codex path validation fails on blur", async () => {
    validateCodexPath.mockResolvedValueOnce({
      valid: false,
      message: "Configured codex path does not exist",
    });
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    const codexPathInput = screen.getByLabelText(/Codex executable path/i);
    fireEvent.change(codexPathInput, {
      target: { value: "C:/missing/codex.exe" },
    });
    fireEvent.blur(codexPathInput);

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

    fireEvent.change(screen.getByLabelText(/Codex personality/i), {
      target: { value: "pragmatic" },
    });
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

  it("opens workspace picker with current input path and applies selected path", async () => {
    openDialog.mockResolvedValueOnce("D:/picked/workspace");
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    const workspaceInput = screen.getByLabelText(/Workspace path/i);
    fireEvent.change(workspaceInput, {
      target: { value: "D:/custom/workspace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Browse workspace folder" }));

    await waitFor(() => {
      expect(openDialog).toHaveBeenCalledWith({
        directory: true,
        multiple: false,
        defaultPath: "D:/custom/workspace",
      });
      expect(screen.getByDisplayValue("D:/picked/workspace")).toBeVisible();
    });
  });

  it("opens CODEX_HOME picker with current input path and applies selected path", async () => {
    openDialog.mockResolvedValueOnce("D:/picked/codex-home");
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    fireEvent.change(screen.getByLabelText(/^CODEX_HOME$/i), {
      target: { value: "D:/custom/codex-home" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Browse CODEX_HOME folder" }));

    await waitFor(() => {
      expect(openDialog).toHaveBeenCalledWith({
        directory: true,
        multiple: false,
        defaultPath: "D:/custom/codex-home",
      });
      expect(screen.getByDisplayValue("D:/picked/codex-home")).toBeVisible();
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });
  });

  it("resets CODEX_HOME to default when using reset button", async () => {
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    fireEvent.change(screen.getByLabelText(/^CODEX_HOME$/i), {
      target: { value: "D:/custom/codex-home" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use default CODEX_HOME" }));
    expect(
      screen.getByText("CODEX_HOME reset to default: C:/Users/test/.codex"),
    ).toBeVisible();

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledTimes(1);
      const savedConfig = saveSettings.mock.calls[0]?.[0];
      expect(savedConfig.codex.homePath).toBe("C:/Users/test/.codex");
    });
  });

  it("shows toast when resetting workspace path to default", async () => {
    render(<SettingsView />);
    await screen.findByRole("heading", { level: 2, name: "Settings" });

    fireEvent.click(screen.getByRole("button", { name: "Use default workspace" }));

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(
          "Workspace path reset to default: C:/Users/test/.minico/workspace",
        ),
      ).toBeVisible();
    });
  });
});
