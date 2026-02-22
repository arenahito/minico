import { describe, expect, it } from "vitest";
import {
  currentApproval,
  enqueueApproval,
  initialApprovalState,
  resolveApproval,
} from "./approvalStore";

describe("approvalStore", () => {
  it("keeps requests in FIFO order", () => {
    const first = enqueueApproval(initialApprovalState, {
      requestId: 1,
      method: "item/commandExecution/requestApproval",
      params: {},
      receivedAt: 1,
    });
    const second = enqueueApproval(first, {
      requestId: 2,
      method: "item/fileChange/requestApproval",
      params: {},
      receivedAt: 2,
    });
    expect(currentApproval(second)?.requestId).toBe(1);
  });

  it("removes resolved request", () => {
    const state = enqueueApproval(initialApprovalState, {
      requestId: 10,
      method: "item/commandExecution/requestApproval",
      params: {},
      receivedAt: 1,
    });
    const next = resolveApproval(state, 10);
    expect(currentApproval(next)).toBeNull();
  });
});

