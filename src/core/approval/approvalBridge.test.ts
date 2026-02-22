import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import {
  cancelApprovalFallback,
  ingestApprovalEvent,
  isApprovalRequestEvent,
  respondApprovalDecision,
} from "./approvalBridge";
import { initialApprovalState } from "./approvalStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("approvalBridge", () => {
  it("recognizes server approval requests", () => {
    const yes = isApprovalRequestEvent({
      kind: "serverRequest",
      id: 9,
      method: "item/commandExecution/requestApproval",
      params: {},
    });
    const no = isApprovalRequestEvent({
      kind: "notification",
      method: "turn/started",
      params: {},
    });

    expect(yes).toBe(true);
    expect(no).toBe(false);
  });

  it("enqueues approval from server request", () => {
    const next = ingestApprovalEvent(initialApprovalState, {
      kind: "serverRequest",
      id: 3,
      method: "item/fileChange/requestApproval",
      params: { reason: "write file" },
    });
    expect(next.pending).toHaveLength(1);
    expect(next.pending[0].requestId).toBe(3);
  });

  it("sends explicit approval decision and fallback cancel", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await respondApprovalDecision(3, "accept");
    await cancelApprovalFallback(4);

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "approval_respond", {
      requestId: 3,
      decision: "accept",
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "approval_respond", {
      requestId: 4,
      decision: "cancel",
    });
  });
});

