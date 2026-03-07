import { invoke } from "@tauri-apps/api/core";
import type { CodexPersonality } from "../settings/types";

export interface ThreadSummary {
  id: string;
  name: string | null;
  preview: string;
}

export interface ThreadHistoryItem {
  id: string;
  itemType: string;
  role: "agent" | "user";
  text: string;
  completed: boolean;
}

export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type ServiceTier = "fast" | "flex";

export interface ModelSummary {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: ReasoningEffort | null;
  supportedReasoningEfforts: ReasoningEffort[];
}

export interface ThreadListResult {
  threads: ThreadSummary[];
  nextCursor: string | null;
}

export interface ModelListResult {
  models: ModelSummary[];
}

export interface ThreadListRequest {
  cursor?: string | null;
  limit?: number;
}

export interface ThreadSessionResult {
  threadId: string;
  cwd: string;
  workspaceFallbackUsed: boolean;
  workspaceWarning: string | null;
  historyItems: ThreadHistoryItem[];
}

export interface TurnStartResult {
  threadId: string;
  turnId: string | null;
  cwd: string;
  workspaceFallbackUsed: boolean;
  workspaceWarning: string | null;
}

export type SessionPolledEvent =
  | {
      kind: "notification";
      method: string;
      params: Record<string, unknown>;
    }
  | {
      kind: "serverRequest";
      id: number;
      method: string;
      params: Record<string, unknown>;
    }
  | {
      kind: "malformedLine";
      raw: string;
      reason: string;
    };

export async function pollSessionEvents(
  timeoutMs = 0,
  maxEvents = 32,
): Promise<SessionPolledEvent[]> {
  return invoke<SessionPolledEvent[]>("session_poll_events", {
    timeoutMs,
    maxEvents,
  });
}

export async function listThreads(
  request?: ThreadListRequest,
): Promise<ThreadListResult> {
  const params: Record<string, unknown> = {};
  if (typeof request?.cursor === "string" && request.cursor.length > 0) {
    params.cursor = request.cursor;
  }
  if (typeof request?.limit === "number") {
    params.limit = request.limit;
  }
  const response =
    Object.keys(params).length === 0
      ? await invoke<ThreadListResult>("thread_list")
      : await invoke<ThreadListResult>("thread_list", params);
  return {
    threads: response.threads ?? [],
    nextCursor:
      typeof response.nextCursor === "string" && response.nextCursor.length > 0
        ? response.nextCursor
        : null,
  };
}

export async function listModels(): Promise<ModelSummary[]> {
  const response = await invoke<ModelListResult>("model_list");
  return response.models;
}

export async function startThread(): Promise<ThreadSessionResult> {
  const response = await invoke<ThreadSessionResult>("thread_start");
  return {
    ...response,
    historyItems: response.historyItems ?? [],
  };
}

export async function resumeThread(
  threadId: string,
): Promise<ThreadSessionResult> {
  const response = await invoke<ThreadSessionResult>("thread_resume", { threadId });
  return {
    ...response,
    historyItems: response.historyItems ?? [],
  };
}

export async function archiveThread(threadId: string): Promise<void> {
  await invoke("thread_archive", { threadId });
}

export async function startTurn(
  threadId: string,
  text: string,
  model: string | null,
  effort: ReasoningEffort | null,
  serviceTier: ServiceTier | null,
  personality: CodexPersonality,
  currentCwd: string | null,
  overrideCwd: string | null,
): Promise<TurnStartResult> {
  return invoke<TurnStartResult>("turn_start", {
    threadId,
    text,
    model,
    effort,
    serviceTier,
    personality,
    currentCwd,
    overrideCwd,
  });
}

export async function interruptTurn(
  threadId: string,
  turnId: string,
): Promise<void> {
  await invoke("turn_interrupt", { threadId, turnId });
}
