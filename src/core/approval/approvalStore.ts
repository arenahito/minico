export type ApprovalMethod =
  | "item/commandExecution/requestApproval"
  | "item/fileChange/requestApproval";

export type ApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export interface PendingApprovalRequest {
  requestId: number;
  method: ApprovalMethod;
  params: Record<string, unknown>;
  receivedAt: number;
}

export interface ApprovalState {
  pending: PendingApprovalRequest[];
}

export const initialApprovalState: ApprovalState = {
  pending: [],
};

export function enqueueApproval(
  state: ApprovalState,
  request: PendingApprovalRequest,
): ApprovalState {
  if (state.pending.some((item) => item.requestId === request.requestId)) {
    return state;
  }
  return {
    ...state,
    pending: [...state.pending, request],
  };
}

export function resolveApproval(
  state: ApprovalState,
  requestId: number,
): ApprovalState {
  return {
    ...state,
    pending: state.pending.filter((item) => item.requestId !== requestId),
  };
}

export function currentApproval(
  state: ApprovalState,
): PendingApprovalRequest | null {
  return state.pending[0] ?? null;
}

