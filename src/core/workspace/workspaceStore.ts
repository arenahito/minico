import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceResolution {
  cwd: string;
  fallbackUsed: boolean;
  warning: string | null;
}

export async function resolveActiveCwd(): Promise<WorkspaceResolution> {
  return invoke<WorkspaceResolution>("workspace_resolve_active_cwd");
}

export async function loadDefaultWorkspacePath(): Promise<string> {
  return invoke<string>("workspace_default_path");
}

export async function withResolvedCwd<T extends object>(
  payload: T,
): Promise<
  T & {
    cwd: string;
    workspaceFallbackUsed: boolean;
    workspaceWarning: string | null;
  }
> {
  const resolved = await resolveActiveCwd();
  return {
    ...payload,
    cwd: resolved.cwd,
    workspaceFallbackUsed: resolved.fallbackUsed,
    workspaceWarning: resolved.warning,
  };
}
