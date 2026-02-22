import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AppShell } from "./AppShell";

const initializeWindowPlacementLifecycle = vi.fn().mockResolvedValue(undefined);
const persistWindowPlacement = vi.fn().mockResolvedValue(undefined);
const openUrl = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrl(...args),
}));

vi.mock("../../core/window/windowStateClient", () => ({
  initializeWindowPlacementLifecycle: (...args: unknown[]) =>
    initializeWindowPlacementLifecycle(...args),
  persistWindowPlacement: (...args: unknown[]) => persistWindowPlacement(...args),
}));

vi.mock("../settings/SettingsView", () => ({
  SettingsView: () => <section aria-label="settings mock">settings</section>,
}));

const mockedInvoke = vi.mocked(invoke);

describe("AppShell", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockedInvoke.mockReset();
    initializeWindowPlacementLifecycle.mockClear();
    persistWindowPlacement.mockClear();
    openUrl.mockClear();
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
      expect(screen.getByText("C:/workspace/demo")).toBeVisible();
      expect(screen.getByLabelText("minico thinking indicator")).toBeVisible();
    });

    unmount();
    expect(initializeWindowPlacementLifecycle).toHaveBeenCalled();
    expect(persistWindowPlacement).toHaveBeenCalled();
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
      if (command === "workspace_resolve_active_cwd") {
        return {
          cwd: "C:/workspace/demo",
          fallbackUsed: false,
          warning: null,
        };
      }
      if (command === "thread_resume") {
        expect(args).toEqual({ threadId: "thread-2" });
        return {
          threadId: "thread-2",
          cwd: "C:/workspace/demo",
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
        return { models: [] };
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

    await user.click(screen.getByRole("button", { name: /second/i }));

    await waitFor(() => {
      expect(screen.getByText("question")).toBeVisible();
      expect(screen.getByText("answer")).toBeVisible();
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
    await waitFor(() => {
      expect(screen.getByText("C:/workspace/demo")).toBeVisible();
    });

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
      });
    });
  });
});
