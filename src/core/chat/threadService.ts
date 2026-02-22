import { invoke } from "@tauri-apps/api/core";

export interface ThreadSummary {
  id: string;
  preview: string;
}

export interface ThreadListResult {
  threads: ThreadSummary[];
}

export interface ThreadSessionResult {
  threadId: string;
  cwd: string;
  workspaceFallbackUsed: boolean;
  workspaceWarning: string | null;
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

export async function startThread(): Promise<ThreadSessionResult> {
  return invoke<ThreadSessionResult>("thread_start");
}

export async function resumeThread(
  threadId: string,
): Promise<ThreadSessionResult> {
  return invoke<ThreadSessionResult>("thread_resume", { threadId });
}

export async function startTurn(
  threadId: string,
  text: string,
): Promise<TurnStartResult> {
  return invoke<TurnStartResult>("turn_start", { threadId, text });
}

export async function interruptTurn(
  threadId: string,
  turnId: string,
): Promise<void> {
  await invoke("turn_interrupt", { threadId, turnId });
}

