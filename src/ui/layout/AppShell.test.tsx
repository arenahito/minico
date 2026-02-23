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
  SettingsView: () => <section aria-label="settings mock">settings</section>,
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
    expect(screen.getByRole("button", { name: /first/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("button", { name: /second/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.queryByText("Loading selected thread...")).toBeNull();

    await user.click(screen.getByRole("button", { name: /second/i }));

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

    const secondThreadButton = screen.getByRole("button", { name: /second/i });
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
        personality: "friendly",
        currentCwd: "C:/workspace/demo",
        overrideCwd: null,
      });
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
