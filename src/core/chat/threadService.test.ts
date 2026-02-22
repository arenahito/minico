import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  interruptTurn,
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
        { id: "t1", preview: "hello" },
        { id: "t2", preview: "world" },
      ],
    });
    await expect(listThreads()).resolves.toEqual([
      { id: "t1", preview: "hello" },
      { id: "t2", preview: "world" },
    ]);
    expect(mockedInvoke).toHaveBeenCalledWith("thread_list");
  });

  it("starts and resumes thread", async () => {
    mockedInvoke.mockResolvedValueOnce({
      threadId: "t-new",
      cwd: "C:/workspace",
      workspaceFallbackUsed: false,
      workspaceWarning: null,
    });
    mockedInvoke.mockResolvedValueOnce({
      threadId: "t-existing",
      cwd: "C:/workspace",
      workspaceFallbackUsed: false,
      workspaceWarning: null,
    });

    await startThread();
    await resumeThread("t-existing");

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "thread_start");
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "thread_resume", {
      threadId: "t-existing",
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

    await startTurn("t1", "hello");
    await interruptTurn("t1", "turn-1");

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "turn_start", {
      threadId: "t1",
      text: "hello",
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "turn_interrupt", {
      threadId: "t1",
      turnId: "turn-1",
    });
  });
});
