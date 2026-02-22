import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { exportDiagnosticsLogs } from "./client";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("diagnostics client", () => {
  it("exports diagnostics through backend command", async () => {
    mockedInvoke.mockResolvedValueOnce({
      logPath: "C:/Users/test/.minico/logs/diagnostics-1.log",
      lineCount: 2,
    });

    await expect(exportDiagnosticsLogs()).resolves.toEqual({
      logPath: "C:/Users/test/.minico/logs/diagnostics-1.log",
      lineCount: 2,
    });
    expect(mockedInvoke).toHaveBeenCalledWith("diagnostics_export_logs");
  });
});

