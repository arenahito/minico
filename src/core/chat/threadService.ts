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
}

export interface ModelListResult {
  models: ModelSummary[];
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

export async function listThreads(): Promise<ThreadSummary[]> {
  const response = await invoke<ThreadListResult>("thread_list");
  return response.threads;
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

export async function startTurn(
  threadId: string,
  text: string,
  model: string | null,
  effort: ReasoningEffort | null,
  personality: CodexPersonality,
  currentCwd: string | null,
  overrideCwd: string | null,
): Promise<TurnStartResult> {
  return invoke<TurnStartResult>("turn_start", {
    threadId,
    text,
    model,
    effort,
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
