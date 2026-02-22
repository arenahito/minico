import { invoke } from "@tauri-apps/api/core";
import type { SessionPolledEvent } from "../chat/threadService";
import {
  enqueueApproval,
  type ApprovalDecision,
  type ApprovalMethod,
  type ApprovalState,
} from "./approvalStore";

function isApprovalMethod(method: string): method is ApprovalMethod {
  return (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  );
}

export function isApprovalRequestEvent(
  event: SessionPolledEvent,
): event is Extract<SessionPolledEvent, { kind: "serverRequest" }> & {
  method: ApprovalMethod;
} {
  return event.kind === "serverRequest" && isApprovalMethod(event.method);
}

export function ingestApprovalEvent(
  state: ApprovalState,
  event: SessionPolledEvent,
  now = Date.now(),
): ApprovalState {
  if (!isApprovalRequestEvent(event)) {
    return state;
  }

  return enqueueApproval(state, {
    requestId: event.id,
    method: event.method,
    params: event.params,
    receivedAt: now,
  });
}

export async function respondApprovalDecision(
  requestId: number,
  decision: ApprovalDecision,
): Promise<void> {
  await invoke("approval_respond", {
    requestId,
    decision,
  });
}

export async function cancelApprovalFallback(requestId: number): Promise<void> {
  await respondApprovalDecision(requestId, "cancel");
}
