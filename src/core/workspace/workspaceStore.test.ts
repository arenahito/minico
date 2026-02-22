import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import {
  loadDefaultWorkspacePath,
  resolveActiveCwd,
  withResolvedCwd,
} from "./workspaceStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("workspaceStore", () => {
  it("loads default workspace path", async () => {
    mockedInvoke.mockResolvedValueOnce("C:/Users/test/.minico/workspace");

    await expect(loadDefaultWorkspacePath()).resolves.toBe(
      "C:/Users/test/.minico/workspace",
    );
    expect(mockedInvoke).toHaveBeenCalledWith("workspace_default_path");
  });

  it("resolves active cwd", async () => {
    mockedInvoke.mockResolvedValueOnce({
      cwd: "C:/workspace/project",
      fallbackUsed: false,
      warning: null,
    });

    await expect(resolveActiveCwd()).resolves.toEqual({
      cwd: "C:/workspace/project",
      fallbackUsed: false,
      warning: null,
    });
    expect(mockedInvoke).toHaveBeenCalledWith("workspace_resolve_active_cwd");
  });

  it("injects resolved cwd into payloads", async () => {
    mockedInvoke.mockResolvedValueOnce({
      cwd: "C:/workspace/project",
      fallbackUsed: false,
      warning: null,
    });

    await expect(withResolvedCwd({ input: "hello" })).resolves.toEqual({
      input: "hello",
      cwd: "C:/workspace/project",
      workspaceFallbackUsed: false,
      workspaceWarning: null,
    });
  });
});
