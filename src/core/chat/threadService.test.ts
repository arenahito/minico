import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveThread,
  interruptTurn,
  listModels,
  listThreads,
  pollSessionEvents,
  resumeThread,
  startThread,
  startTurn,
} from "./threadService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("threadService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("polls session events with timeout and limit", async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await expect(pollSessionEvents(100, 5)).resolves.toEqual([]);
    expect(mockedInvoke).toHaveBeenCalledWith("session_poll_events", {
      timeoutMs: 100,
      maxEvents: 5,
    });
  });

  it("loads thread list through backend command", async () => {
    mockedInvoke.mockResolvedValueOnce({
      threads: [
        { id: "t1", name: "Title 1", preview: "hello" },
        { id: "t2", name: null, preview: "world" },
      ],
    });
    await expect(listThreads()).resolves.toEqual([
      { id: "t1", name: "Title 1", preview: "hello" },
      { id: "t2", name: null, preview: "world" },
    ]);
    expect(mockedInvoke).toHaveBeenCalledWith("thread_list");
  });

  it("loads model list through backend command", async () => {
    mockedInvoke.mockResolvedValueOnce({
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
          supportedReasoningEfforts: ["minimal", "low", "medium"],
        },
      ],
    });

    await expect(listModels()).resolves.toEqual([
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
        supportedReasoningEfforts: ["minimal", "low", "medium"],
      },
    ]);
    expect(mockedInvoke).toHaveBeenCalledWith("model_list");
  });

  it("starts and resumes thread", async () => {
    mockedInvoke.mockResolvedValueOnce({
      threadId: "t-new",
      cwd: "C:/workspace",
      workspaceFallbackUsed: false,
      workspaceWarning: null,
      historyItems: [],
    });
    mockedInvoke.mockResolvedValueOnce({
      threadId: "t-existing",
      cwd: "C:/workspace",
      workspaceFallbackUsed: false,
      workspaceWarning: null,
      historyItems: [],
    });

    await startThread();
    await resumeThread("t-existing");

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "thread_start");
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "thread_resume", {
      threadId: "t-existing",
    });
  });

  it("archives thread through backend command", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await archiveThread("t-archive");
    expect(mockedInvoke).toHaveBeenCalledWith("thread_archive", {
      threadId: "t-archive",
    });
  });

  it("starts and interrupts turn", async () => {
    mockedInvoke.mockResolvedValueOnce({
      threadId: "t1",
      turnId: "turn-1",
      cwd: "C:/workspace",
      workspaceFallbackUsed: false,
      workspaceWarning: null,
    });
    mockedInvoke.mockResolvedValueOnce(undefined);

    await startTurn(
      "t1",
      "hello",
      "gpt-5",
      "medium",
      "friendly",
      "C:/thread/cwd",
      "D:/override/cwd",
    );
    await interruptTurn("t1", "turn-1");

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "turn_start", {
      threadId: "t1",
      text: "hello",
      model: "gpt-5",
      effort: "medium",
      personality: "friendly",
      currentCwd: "C:/thread/cwd",
      overrideCwd: "D:/override/cwd",
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "turn_interrupt", {
      threadId: "t1",
      turnId: "turn-1",
    });
  });
});
