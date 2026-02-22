export type DiagnosticsLogLevel = "error" | "warn" | "info" | "debug";

export interface WindowPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
  scaleFactor?: number | null;
}

export interface MinicoConfig {
  schemaVersion: number;
  codex: {
    path: string | null;
    homeIsolation: boolean;
  };
  workspace: {
    lastPath: string | null;
  };
  diagnostics: {
    logLevel: DiagnosticsLogLevel;
  };
  window: {
    placement: WindowPlacement;
    threadPanelWidth?: number | null;
    threadPanelOpen?: boolean | null;
    selectedModel?: string | null;
    selectedEffort?: string | null;
  };
}

export interface SettingsSnapshot {
  config: MinicoConfig;
  configPath: string;
  effectiveCodexHome: string | null;
}

export interface CodexPathValidationResult {
  valid: boolean;
  message: string | null;
}
