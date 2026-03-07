import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AppShell } from "./AppShell";

const initializeWindowPlacementLifecycle = vi.fn().mockResolvedValue(undefined);
const disposeWindowPlacementLifecycle = vi.fn();
const persistWindowPlacement = vi.fn().mockResolvedValue(undefined);
const loadThreadPanelOpenRecord = vi.fn().mockResolvedValue(null);
const loadThreadPanelWidthRecord = vi.fn().mockResolvedValue(null);
const persistThreadPanelOpenRecord = vi.fn().mockResolvedValue(undefined);
const persistThreadPanelWidthRecord = vi.fn().mockResolvedValue(undefined);
const loadModelPreferenceRecord = vi.fn().mockResolvedValue(null);
const persistModelPreferenceRecord = vi.fn().mockResolvedValue(undefined);
const openUrl = vi.fn().mockResolvedValue(undefined);
const openDialog = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrl(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialog(...args),
}));

vi.mock("../../core/window/windowStateClient", () => ({
  disposeWindowPlacementLifecycle: (...args: unknown[]) =>
    disposeWindowPlacementLifecycle(...args),
  initializeWindowPlacementLifecycle: (...args: unknown[]) =>
    initializeWindowPlacementLifecycle(...args),
  persistWindowPlacement: (...args: unknown[]) => persistWindowPlacement(...args),
  loadThreadPanelOpenRecord: (...args: unknown[]) =>
    loadThreadPanelOpenRecord(...args),
  loadThreadPanelWidthRecord: (...args: unknown[]) =>
    loadThreadPanelWidthRecord(...args),
  persistThreadPanelOpenRecord: (...args: unknown[]) =>
    persistThreadPanelOpenRecord(...args),
  persistThreadPanelWidthRecord: (...args: unknown[]) =>
    persistThreadPanelWidthRecord(...args),
  loadModelPreferenceRecord: (...args: unknown[]) =>
    loadModelPreferenceRecord(...args),
  persistModelPreferenceRecord: (...args: unknown[]) =>
    persistModelPreferenceRecord(...args),
}));

vi.mock("../settings/SettingsView", () => ({
  SettingsView: ({
    onSaved,
  }: {
    onSaved?: (config: unknown) => void;
  }) => (
    <section aria-label="settings mock">
      settings
      <button
        type="button"
        onClick={() =>
          onSaved?.(
            {
              schemaVersion: 1,
              codex: {
                path: null,
                homePath: "C:/alt-codex-home",
                personality: "friendly",
              },
              workspace: { lastPath: "C:/workspace/demo" },
              diagnostics: { logLevel: "info" },
              appearance: { theme: "light" },
              window: {
                placement: {
                  x: 100,
                  y: 100,
                  width: 1000,
                  height: 700,
                  maximized: false,
                  scaleFactor: null,
                },
              },
            },
          )
        }
      >
        mock codex home changed
      </button>
      <button
        type="button"
        onClick={() =>
          onSaved?.({
            schemaVersion: 1,
            codex: {
              path: null,
              homePath: "~/.minico/codex",
              personality: "friendly",
            },
            workspace: { lastPath: "C:/workspace/demo" },
            diagnostics: { logLevel: "info" },
            appearance: { theme: "light" },
            window: {
              placement: {
                x: 100,
                y: 100,
                width: 1000,
                height: 700,
                maximized: false,
                scaleFactor: null,
              },
            },
          })
        }
      >
        mock codex home reverted
      </button>
    </section>
  ),
}));

const mockedInvoke = vi.mocked(invoke);

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("AppShell", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockedInvoke.mockReset();
    disposeWindowPlacementLifecycle.mockClear();
    initializeWindowPlacementLifecycle.mockClear();
    persistWindowPlacement.mockClear();
    loadThreadPanelOpenRecord.mockClear();
    loadThreadPanelOpenRecord.mockResolvedValue(null);
    loadThreadPanelWidthRecord.mockClear();
    loadThreadPanelWidthRecord.mockResolvedValue(null);
    persistThreadPanelOpenRecord.mockClear();
    persistThreadPanelWidthRecord.mockClear();
    loadModelPreferenceRecord.mockClear();
    loadModelPreferenceRecord.mockResolvedValue(null);
    persistModelPreferenceRecord.mockClear();
    openUrl.mockClear();
    openDialog.mockReset();
  });

  it("renders login-required branch", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loginRequired",
          accountEmail: null,
          requiresOpenaiAuth: true,
          rawAuthMode: null,
          message: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);

    await expect(
      screen.findByRole("heading", { level: 2, name: "Login required" }),
    ).resolves.toBeVisible();
    expect(screen.getByLabelText("CODEX_HOME")).toBeVisible();
    expect(screen.getByRole("button", { name: "Browse CODEX_HOME folder" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Use default CODEX_HOME" })).toBeVisible();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("renders unsupported auth branch", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "unsupportedApiKey",
          accountEmail: null,
          requiresOpenaiAuth: false,
          rawAuthMode: "apikey",
          message: "API key mode is not supported",
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);

    await expect(
      screen.findByRole("heading", {
        level: 2,
        name: "API key mode is not supported",
      }),
    ).resolves.toBeVisible();
  });

  it("shows active turn status from streamed notification in logged-in branch", async () => {
    let pollCount = 0;
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return {
          threads: [{ id: "thread-1", name: null, preview: "demo thread" }],
        };
      }
      if (command === "session_poll_events") {
        pollCount += 1;
        if (pollCount === 1) {
          return [
            {
              kind: "notification",
              method: "turn/started",
              params: {
                threadId: "thread-1",
                turn: { id: "turn-1" },
              },
            },
          ];
        }
        return [];
      }
      return undefined;
    });

    const { unmount } = render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByText("(resolving cwd...)")).toBeVisible();
      expect(screen.getByLabelText("minico thinking indicator")).toBeVisible();
    });

    unmount();
    expect(initializeWindowPlacementLifecycle).toHaveBeenCalled();
    expect(disposeWindowPlacementLifecycle).toHaveBeenCalled();
  });

  it("opens settings in a modal from the left toolbar", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "settings_read") {
        return {
          config: {
            codex: { homePath: "~/.minico/codex" },
          },
        };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Threads" })).toBeVisible();
    });
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByLabelText("settings mock")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    });
  });

  it("reinitializes app when CODEX_HOME changed and settings is closed", async () => {
    const user = userEvent.setup();
    const nextAuthDeferred = deferred<unknown>();
    let authReadCount = 0;
    let pollCount = 0;

    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "auth_read_status") {
        authReadCount += 1;
        if (authReadCount === 1) {
          return {
            state: "loggedIn",
            accountEmail: "demo@example.com",
            requiresOpenaiAuth: false,
            rawAuthMode: "chatgpt",
            message: null,
          };
        }
        return nextAuthDeferred.promise;
      }
      if (command === "thread_list") {
        return {
          threads: [{ id: "thread-1", name: null, preview: "first" }],
          nextCursor: null,
        };
      }
      if (command === "settings_read") {
        return {
          config: {
            codex: { homePath: "~/.minico/codex" },
          },
        };
      }
      if (command === "thread_resume") {
        expect(args).toEqual({ threadId: "thread-1" });
        return {
          threadId: "thread-1",
          cwd: "C:/workspace/thread-1",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
          historyItems: [],
        };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "model_list") {
        return { models: [] };
      }
      if (command === "session_poll_events") {
        pollCount += 1;
        if (pollCount === 1) {
          return [
            {
              kind: "notification",
              method: "turn/started",
              params: {
                threadId: "thread-1",
                turn: { id: "turn-1" },
              },
            },
          ];
        }
        return [];
      }
      if (command === "turn_interrupt") {
        return {};
      }
      if (command === "session_reset_runtime") {
        return {};
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "first" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "first" }));
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("thread_resume", {
        threadId: "thread-1",
      });
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await user.click(screen.getByRole("button", { name: "mock codex home changed" }));
    await user.click(screen.getByRole("button", { name: "Close settings" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("session_reset_runtime");
      expect(screen.getByRole("heading", { name: "Preparing minico" })).toBeVisible();
    });
  });

  it("does not reinitialize when CODEX_HOME is changed and then reverted before closing settings", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [], nextCursor: null };
      }
      if (command === "settings_read") {
        return {
          config: {
            codex: { homePath: "~/.minico/codex" },
          },
        };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "model_list") {
        return { models: [] };
      }
      if (command === "session_poll_events") {
        return [];
      }
      if (command === "session_reset_runtime") {
        return {};
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Threads" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await user.click(screen.getByRole("button", { name: "mock codex home changed" }));
    await user.click(screen.getByRole("button", { name: "mock codex home reverted" }));
    await user.click(screen.getByRole("button", { name: "Close settings" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "Threads" })).toBeVisible();
    });
    expect(mockedInvoke).not.toHaveBeenCalledWith("session_reset_runtime");
  });

  it("shows default workspace path when no thread is selected", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/default",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByText("C:/workspace/default")).toBeVisible();
    });
  });

  it("archives thread from thread list action", async () => {
    const user = userEvent.setup();
    let threadListCount = 0;
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        threadListCount += 1;
        if (threadListCount === 1) {
          return {
            threads: [
              { id: "thread-1", name: "thread one", preview: "first" },
              { id: "thread-2", name: "thread two", preview: "second" },
            ],
          };
        }
        return {
          threads: [{ id: "thread-2", name: "thread two", preview: "second" }],
        };
      }
      if (command === "thread_archive") {
        expect(args).toEqual({ threadId: "thread-1" });
        return {};
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByText("thread one")).toBeVisible();
      expect(screen.getByText("thread two")).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "Archive thread thread one" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("thread_archive", {
        threadId: "thread-1",
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("thread one")).toBeNull();
      expect(screen.getByText("thread two")).toBeVisible();
    });
  });

  it("loads threads in pages of five and fetches next page on demand", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        if (args && (args as { cursor?: string }).cursor === "cursor-1") {
          return {
            threads: [
              { id: "thread-6", name: "thread 6", preview: "sixth" },
              { id: "thread-7", name: "thread 7", preview: "seventh" },
            ],
            nextCursor: null,
          };
        }
        return {
          threads: [
            { id: "thread-1", name: "thread 1", preview: "first" },
            { id: "thread-2", name: "thread 2", preview: "second" },
            { id: "thread-3", name: "thread 3", preview: "third" },
            { id: "thread-4", name: "thread 4", preview: "fourth" },
            { id: "thread-5", name: "thread 5", preview: "fifth" },
          ],
          nextCursor: "cursor-1",
        };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "model_list") {
        return { models: [] };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByText("thread 1")).toBeVisible();
      expect(screen.getByText("thread 5")).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "Load more threads" }));

    await waitFor(() => {
      expect(screen.getByText("thread 6")).toBeVisible();
      expect(screen.getByText("thread 7")).toBeVisible();
    });
    expect(mockedInvoke).toHaveBeenCalledWith("thread_list", { limit: 30 });
    expect(mockedInvoke).toHaveBeenCalledWith("thread_list", {
      cursor: "cursor-1",
      limit: 30,
    });
  });

  it("does not start a thread on create until first prompt is sent", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "thread_start") {
        return {
          threadId: "thread-new",
          cwd: "C:/workspace/new",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5",
              displayName: "gpt-5",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
          ],
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Threads" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "Create new thread" }));
    expect(mockedInvoke).not.toHaveBeenCalledWith("thread_start");

    await user.type(screen.getByRole("textbox"), "hello");
    await user.click(screen.getByRole("button", { name: "Send prompt" }));
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("thread_start");
      expect(mockedInvoke).toHaveBeenCalledWith("turn_start", {
        threadId: "thread-new",
        text: "hello",
        model: "gpt-5",
        effort: "medium",
        serviceTier: null,
        personality: "friendly",
        currentCwd: "C:/workspace/new",
        overrideCwd: null,
      });
    });
  });

  it("does not resume when selecting the already active thread", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return {
          threads: [{ id: "thread-1", name: null, preview: "first" }],
        };
      }
      if (command === "thread_resume") {
        return {
          threadId: "thread-1",
          cwd: "C:/workspace/thread-1",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
          historyItems: [],
        };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5",
              displayName: "gpt-5",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
          ],
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Threads" })).toBeVisible();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "first" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "first" }));
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("thread_resume", {
        threadId: "thread-1",
      });
    });
    const resumeCallCountAfterFirstClick = mockedInvoke.mock.calls.filter(
      ([command]) => command === "thread_resume",
    ).length;

    await user.click(screen.getByRole("button", { name: "first" }));
    const resumeCallCountAfterSecondClick = mockedInvoke.mock.calls.filter(
      ([command]) => command === "thread_resume",
    ).length;
    expect(resumeCallCountAfterSecondClick).toBe(resumeCallCountAfterFirstClick);
  });

  it("re-reads auth status after login completion success notification", async () => {
    const user = userEvent.setup();
    let readCount = 0;
    let pollCount = 0;
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        readCount += 1;
        if (readCount === 1) {
          return {
            state: "loginRequired",
            accountEmail: null,
            requiresOpenaiAuth: true,
            rawAuthMode: null,
            message: null,
          };
        }
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "session_poll_events") {
        pollCount += 1;
        if (pollCount === 1) {
          return [
            {
              kind: "notification",
              method: "account/login/completed",
              params: { success: true, error: null },
            },
          ];
        }
        return [];
      }
      if (command === "auth_login_start_chatgpt") {
        return {
          authUrl: "https://example.com/auth",
          loginId: "login-1",
        };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      return undefined;
    });

    render(<AppShell />);
    await screen.findByRole("heading", { level: 2, name: "Login required" });
    await user.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Threads" })).toBeVisible();
    });
    expect(readCount).toBeGreaterThanOrEqual(2);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/auth");
  });

  it("saves CODEX_HOME before starting ChatGPT login", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "auth_read_status") {
        return {
          state: "loginRequired",
          accountEmail: null,
          requiresOpenaiAuth: true,
          rawAuthMode: null,
          message: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      if (command === "settings_read") {
        return {
          configPath: "C:/Users/test/.minico/config.toml",
          effectiveCodexHome: "C:/Users/test/.minico/codex",
          config: {
            schemaVersion: 1,
            codex: {
              path: null,
              homePath: "~/.minico/codex",
              personality: "friendly",
            },
            workspace: {
              lastPath: "C:/Users/test/.minico/workspace",
            },
            diagnostics: { logLevel: "info" },
            appearance: { theme: "light" },
            window: {
              placement: {
                x: 100,
                y: 100,
                width: 1000,
                height: 700,
                maximized: false,
                scaleFactor: null,
              },
            },
          },
        };
      }
      if (command === "settings_write") {
        const nextConfig = (args as { config: { codex: { homePath: string } } }).config;
        return {
          configPath: "C:/Users/test/.minico/config.toml",
          effectiveCodexHome: nextConfig.codex.homePath,
          config: nextConfig,
        };
      }
      if (command === "session_reset_runtime") {
        return undefined;
      }
      if (command === "auth_login_start_chatgpt") {
        return {
          authUrl: "https://example.com/auth",
          loginId: "login-1",
        };
      }
      return undefined;
    });

    render(<AppShell />);
    await screen.findByRole("heading", { level: 2, name: "Login required" });

    fireEvent.change(screen.getByLabelText("CODEX_HOME"), {
      target: { value: "C:/custom/codex-home" },
    });
    await user.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));

    await waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith("https://example.com/auth");
    });

    const settingsWriteIndex = mockedInvoke.mock.calls.findIndex(
      ([command]) => command === "settings_write",
    );
    const loginStartIndex = mockedInvoke.mock.calls.findIndex(
      ([command]) => command === "auth_login_start_chatgpt",
    );
    expect(settingsWriteIndex).toBeGreaterThan(-1);
    expect(loginStartIndex).toBeGreaterThan(settingsWriteIndex);
    expect(mockedInvoke).toHaveBeenCalledWith(
      "settings_write",
      expect.objectContaining({
        config: expect.objectContaining({
          codex: expect.objectContaining({
            homePath: "C:/custom/codex-home",
          }),
        }),
      }),
    );
  });

  it("keeps expanded default CODEX_HOME display when pressing reset repeatedly", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loginRequired",
          accountEmail: null,
          requiresOpenaiAuth: true,
          rawAuthMode: null,
          message: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      if (command === "settings_read") {
        return {
          configPath: "C:/Users/test/.minico/config.toml",
          effectiveCodexHome: "C:/Users/test/.minico/codex",
          config: {
            schemaVersion: 1,
            codex: {
              path: null,
              homePath: "~/.minico/codex",
              personality: "friendly",
            },
            workspace: {
              lastPath: "C:/Users/test/.minico/workspace",
            },
            diagnostics: { logLevel: "info" },
            appearance: { theme: "light" },
            window: {
              placement: {
                x: 100,
                y: 100,
                width: 1000,
                height: 700,
                maximized: false,
                scaleFactor: null,
              },
            },
          },
        };
      }
      return undefined;
    });

    render(<AppShell />);
    await screen.findByRole("heading", { level: 2, name: "Login required" });

    const codexHomeInput = screen.getByLabelText("CODEX_HOME") as HTMLInputElement;
    expect(codexHomeInput.value).toBe("C:/Users/test/.minico/codex");

    await user.click(screen.getByRole("button", { name: "Use default CODEX_HOME" }));
    expect(codexHomeInput.value).toBe("C:/Users/test/.minico/codex");

    await user.click(screen.getByRole("button", { name: "Use default CODEX_HOME" }));
    expect(codexHomeInput.value).toBe("C:/Users/test/.minico/codex");
  });

  it("keeps approval dialog queued when response and fallback both fail", async () => {
    const user = userEvent.setup();
    let pollCount = 0;
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "session_poll_events") {
        pollCount += 1;
        if (pollCount === 1) {
          return [
            {
              kind: "serverRequest",
              id: 99,
              method: "item/commandExecution/requestApproval",
              params: {
                command: { command: ["echo", "hello"], cwd: "C:/workspace" },
              },
            },
          ];
        }
        return [];
      }
      if (command === "approval_respond") {
        throw new Error("transport failed");
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByText("Command approval required")).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => {
      expect(screen.getByText("Command approval required")).toBeVisible();
      expect(mockedInvoke).toHaveBeenCalledWith("approval_respond", {
        requestId: 99,
        decision: "accept",
      });
      expect(mockedInvoke).toHaveBeenCalledWith("approval_respond", {
        requestId: 99,
        decision: "cancel",
      });
    });
  });

  it("hydrates chat items when selecting a thread", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return {
          threads: [
            { id: "thread-1", name: null, preview: "first" },
            { id: "thread-2", name: null, preview: "second" },
          ],
        };
      }
      if (command === "thread_resume") {
        expect(args).toEqual({ threadId: "thread-2" });
        return {
          threadId: "thread-2",
          cwd: "C:/workspace/thread-2",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
          historyItems: [
            {
              id: "item-user-1",
              itemType: "userMessage",
              role: "user",
              text: "question",
              completed: true,
            },
            {
              id: "item-agent-1",
              itemType: "agentMessage",
              role: "agent",
              text: "answer",
              completed: true,
            },
          ],
        };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5",
              displayName: "gpt-5",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
          ],
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByText("second")).toBeVisible();
    });
    expect(screen.getByRole("button", { name: "first" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("button", { name: "second" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.queryByText("Loading selected thread...")).toBeNull();

    await user.click(screen.getByRole("button", { name: "second" }));

    await waitFor(() => {
      expect(screen.getByText("question")).toBeVisible();
      expect(screen.getByText("answer")).toBeVisible();
      expect(screen.getByText("C:/workspace/thread-2")).toBeVisible();
    });
  });

  it("updates selection immediately and shows loading state while resuming thread", async () => {
    const user = userEvent.setup();
    const resumeDeferred = deferred<unknown>();

    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return {
          threads: [
            { id: "thread-1", name: null, preview: "first" },
            { id: "thread-2", name: null, preview: "second" },
          ],
        };
      }
      if (command === "thread_resume") {
        expect(args).toEqual({ threadId: "thread-2" });
        return resumeDeferred.promise;
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5",
              displayName: "gpt-5",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
          ],
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByText("second")).toBeVisible();
    });

    const secondThreadButton = screen.getByRole("button", { name: "second" });
    await user.click(secondThreadButton);

    expect(secondThreadButton).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Loading selected thread...")).toBeVisible();

    resumeDeferred.resolve({
      threadId: "thread-2",
      cwd: "C:/workspace/thread-2",
      workspaceFallbackUsed: false,
      workspaceWarning: null,
      historyItems: [
        {
          id: "item-user-2",
          itemType: "userMessage",
          role: "user",
          text: "follow-up",
          completed: true,
        },
        {
          id: "item-agent-2",
          itemType: "agentMessage",
          role: "agent",
          text: "resolved",
          completed: true,
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("follow-up")).toBeVisible();
      expect(screen.getByText("resolved")).toBeVisible();
      expect(screen.getByText("C:/workspace/thread-2")).toBeVisible();
    });
  });

  it("submits turn with selected model and reasoning effort", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5",
              displayName: "GPT-5",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
            {
              id: "m2",
              model: "gpt-5-mini",
              displayName: "GPT-5 mini",
              isDefault: false,
              defaultReasoningEffort: "low",
              supportedReasoningEfforts: ["minimal", "low", "high"],
            },
          ],
        };
      }
      if (command === "thread_start") {
        return {
          threadId: "thread-1",
          cwd: "C:/workspace/demo",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "turn_start") {
        return {
          threadId: "thread-1",
          turnId: "turn-1",
          cwd: "C:/workspace/demo",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await screen.findByRole("button", { name: "Select model" });

    await user.click(screen.getByRole("button", { name: "Select model" }));
    await user.click(screen.getByRole("option", { name: "GPT-5 mini" }));
    await user.click(screen.getByRole("option", { name: "high" }));
    expect(screen.getByText("gpt-5-mini / high")).toBeVisible();
    await user.type(screen.getByRole("textbox"), "hello");
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("turn_start", {
        threadId: "thread-1",
        text: "hello",
        model: "gpt-5-mini",
        effort: "high",
        serviceTier: null,
        personality: "friendly",
        currentCwd: "C:/workspace/demo",
        overrideCwd: null,
      });
    });
  });

  it("submits turn with fast service tier when the fast toggle is enabled", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5",
              displayName: "GPT-5",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
          ],
        };
      }
      if (command === "thread_start") {
        return {
          threadId: "thread-1",
          cwd: "C:/workspace/demo",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "turn_start") {
        return {
          threadId: "thread-1",
          turnId: "turn-1",
          cwd: "C:/workspace/demo",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await screen.findByRole("button", { name: "Toggle fast mode" });

    const fastToggle = screen.getByRole("button", { name: "Toggle fast mode" });
    expect(fastToggle).toHaveAttribute("aria-pressed", "false");

    await user.click(fastToggle);
    expect(screen.getByRole("dialog", { name: "Enable fast mode" })).toBeVisible();
    expect(
      screen.getByText(
        "Enabling fast mode increases token usage in exchange for faster reasoning.",
      ),
    ).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Enable fast mode" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Enable fast mode" }));
    expect(screen.queryByRole("dialog", { name: "Enable fast mode" })).not.toBeInTheDocument();
    expect(fastToggle).toHaveAttribute("aria-pressed", "true");

    await user.type(screen.getByRole("textbox"), "hello");
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("turn_start", {
        threadId: "thread-1",
        text: "hello",
        model: "gpt-5",
        effort: "medium",
        serviceTier: "fast",
        personality: "friendly",
        currentCwd: "C:/workspace/demo",
        overrideCwd: null,
      });
    });
  });

  it("turns fast mode off immediately when it is already enabled", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5",
              displayName: "gpt-5",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
            },
          ],
        };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "thread_start") {
        return {
          threadId: "thread-1",
          cwd: "C:/workspace/demo",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "turn_start") {
        return {
          threadId: "thread-1",
          turnId: "turn-1",
          cwd: "C:/workspace/demo",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await screen.findByRole("button", { name: "Toggle fast mode" });

    const fastToggle = screen.getByRole("button", { name: "Toggle fast mode" });
    await user.click(fastToggle);
    await user.click(screen.getByRole("button", { name: "Enable fast mode" }));
    expect(fastToggle).toHaveAttribute("aria-pressed", "true");

    await user.click(fastToggle);
    expect(screen.queryByRole("dialog", { name: "Enable fast mode" })).not.toBeInTheDocument();
    expect(fastToggle).toHaveAttribute("aria-pressed", "false");

    await user.type(screen.getByRole("textbox"), "hello");
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("turn_start", {
        threadId: "thread-1",
        text: "hello",
        model: "gpt-5",
        effort: "medium",
        serviceTier: null,
        personality: "friendly",
        currentCwd: "C:/workspace/demo",
        overrideCwd: null,
      });
    });
  });

  it("keeps fast mode disabled when the confirmation dialog is cancelled", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5",
              displayName: "gpt-5",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
            },
          ],
        };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "thread_start") {
        return {
          threadId: "thread-1",
          cwd: "C:/workspace/demo",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "turn_start") {
        return {
          threadId: "thread-1",
          turnId: "turn-1",
          cwd: "C:/workspace/demo",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await screen.findByRole("button", { name: "Toggle fast mode" });

    const fastToggle = screen.getByRole("button", { name: "Toggle fast mode" });
    await user.click(fastToggle);
    expect(screen.getByRole("dialog", { name: "Enable fast mode" })).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Enable fast mode" })).toHaveFocus();
    });

    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Enable fast mode" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Enable fast mode" })).not.toBeInTheDocument();
    expect(fastToggle).toHaveAttribute("aria-pressed", "false");
    expect(fastToggle).toHaveFocus();

    await user.type(screen.getByRole("textbox"), "hello");
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("turn_start", {
        threadId: "thread-1",
        text: "hello",
        model: "gpt-5",
        effort: "medium",
        serviceTier: null,
        personality: "friendly",
        currentCwd: "C:/workspace/demo",
        overrideCwd: null,
      });
    });
  });

  it("refreshes thread title after first agent response", async () => {
    const user = userEvent.setup();
    let threadListCount = 0;
    let started = false;
    let emittedFirstDelta = false;

    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        threadListCount += 1;
        if (threadListCount <= 2) {
          return { threads: [] };
        }
        return {
          threads: [{ id: "thread-1", name: "Greeting thread", preview: "hello" }],
        };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5",
              displayName: "gpt-5",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
          ],
        };
      }
      if (command === "thread_start") {
        return {
          threadId: "thread-1",
          cwd: "C:/workspace/demo",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "turn_start") {
        started = true;
        return {
          threadId: "thread-1",
          turnId: "turn-1",
          cwd: "C:/workspace/demo",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "session_poll_events") {
        if (started && !emittedFirstDelta) {
          emittedFirstDelta = true;
          return [
            {
              kind: "notification",
              method: "item/agentMessage/delta",
              params: { delta: "hello" },
            },
          ];
        }
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Threads" })).toBeVisible();
    });

    await user.type(screen.getByRole("textbox"), "hello");
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    await waitFor(() => {
      expect(screen.getByText("(No title yet)")).toBeVisible();
    });
    await waitFor(() => {
      expect(screen.getByText("Greeting thread")).toBeVisible();
    });
  });

  it("applies selected thread path as cwd override on next turn", async () => {
    const user = userEvent.setup();
    openDialog.mockResolvedValueOnce("D:/work/override");
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5",
              displayName: "gpt-5",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
          ],
        };
      }
      if (command === "thread_start") {
        return {
          threadId: "thread-1",
          cwd: "C:/workspace/demo",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "turn_start") {
        return {
          threadId: "thread-1",
          turnId: "turn-1",
          cwd: "D:/work/override",
          workspaceFallbackUsed: false,
          workspaceWarning: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await screen.findByRole("button", { name: "Select thread cwd" });

    await user.click(screen.getByRole("button", { name: "Select thread cwd" }));
    await user.type(screen.getByRole("textbox"), "hello");
    await user.click(screen.getByRole("button", { name: "Send prompt" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("turn_start", {
        threadId: "thread-1",
        text: "hello",
        model: "gpt-5",
        effort: "medium",
        serviceTier: null,
        personality: "friendly",
        currentCwd: "C:/workspace/demo",
        overrideCwd: "D:/work/override",
      });
    });
  });

  it("restores persisted model and effort on startup", async () => {
    loadModelPreferenceRecord.mockResolvedValueOnce({
      model: "gpt-5.2-codex",
      effort: "high",
      serviceTier: "fast",
    });
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5.2-codex",
              displayName: "gpt-5.2-codex",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
            {
              id: "m2",
              model: "gpt-5-mini",
              displayName: "gpt-5-mini",
              isDefault: false,
              defaultReasoningEffort: "low",
              supportedReasoningEfforts: ["minimal", "low", "high"],
            },
          ],
        };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByText("gpt-5.2-codex / high")).toBeVisible();
    });
    expect(screen.getByRole("button", { name: "Toggle fast mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("does not persist null effort before startup model preference restore completes", async () => {
    const preferenceDeferred = deferred<{
      model: string;
      effort: string | null;
      serviceTier: "fast" | "flex" | null;
    }>();
    loadModelPreferenceRecord.mockReturnValueOnce(preferenceDeferred.promise);

    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5.2-codex",
              displayName: "gpt-5.2-codex",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
          ],
        };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);

    await waitFor(() => {
      expect(loadModelPreferenceRecord).toHaveBeenCalledTimes(1);
    });
    expect(persistModelPreferenceRecord).not.toHaveBeenCalled();

    preferenceDeferred.resolve({
      model: "gpt-5.2-codex",
      effort: "high",
      serviceTier: "fast",
    });

    await waitFor(() => {
      expect(screen.getByText("gpt-5.2-codex / high")).toBeVisible();
    });
    expect(persistModelPreferenceRecord).not.toHaveBeenCalledWith(
      "gpt-5.2-codex",
      null,
      null,
    );
  });

  it("keeps selected effort when reopening effort list for the same model", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "model_list") {
        return {
          models: [
            {
              id: "m1",
              model: "gpt-5.2-codex",
              displayName: "gpt-5.2-codex",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
          ],
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByText("(resolving cwd...)")).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "Select model" }));
    await user.click(screen.getByRole("option", { name: "gpt-5.2-codex" }));
    await user.click(screen.getByRole("option", { name: "high" }));
    expect(screen.getByText("gpt-5.2-codex / high")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Select model" }));
    await user.click(screen.getByRole("option", { name: "gpt-5.2-codex" }));

    expect(screen.getByRole("option", { name: "high" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "medium" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("restores thread panel width and persists updated width after dragging", async () => {
    loadThreadPanelWidthRecord.mockResolvedValueOnce(420);
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [] };
      }
      if (command === "model_list") {
        return { models: [] };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Threads" })).toBeVisible();
    });

    const appMain = screen.getByRole("main");
    await waitFor(() => {
      expect(appMain).toHaveStyle("--thread-panel-width: 420px");
    });

    const resizer = screen.getByRole("separator", { name: "Resize thread panel" });
    fireEvent.pointerDown(resizer, { button: 0, clientX: 420 });
    fireEvent.pointerMove(window, { clientX: 470 });
    fireEvent.pointerUp(window);

    await waitFor(() => {
      expect(persistThreadPanelWidthRecord).toHaveBeenCalledWith(470);
    });
  });

  it("restores thread panel open state and persists toggle", async () => {
    const user = userEvent.setup();
    loadThreadPanelOpenRecord.mockResolvedValueOnce(false);
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "auth_read_status") {
        return {
          state: "loggedIn",
          accountEmail: "demo@example.com",
          requiresOpenaiAuth: false,
          rawAuthMode: "chatgpt",
          message: null,
        };
      }
      if (command === "thread_list") {
        return { threads: [{ id: "thread-1", name: null, preview: "first" }] };
      }
      if (command === "model_list") {
        return { models: [] };
      }
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "session_poll_events") {
        return [];
      }
      return undefined;
    });

    render(<AppShell />);
    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 2, name: "Threads" })).toBeNull();
    });

    const toggleButton = screen.getByRole("button", { name: "Toggle thread panel" });
    await user.click(toggleButton);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Threads" })).toBeVisible();
      expect(persistThreadPanelOpenRecord).toHaveBeenCalledWith(true);
    });

    await user.click(toggleButton);

    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 2, name: "Threads" })).toBeNull();
      expect(persistThreadPanelOpenRecord).toHaveBeenCalledWith(false);
    });
  });
});
