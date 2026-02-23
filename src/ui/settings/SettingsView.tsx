import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileDown, FolderOpen, RotateCcw } from "lucide-react";

import {
  loadSettings,
  saveSettings,
  validateCodexPath,
} from "../../core/settings/store";
import { exportDiagnosticsLogs } from "../../core/diagnostics/client";
import {
  loadDefaultWorkspacePath,
  resolveActiveCwd,
} from "../../core/workspace/workspaceStore";
import type {
  AppTheme,
  CodexPersonality,
  CodexPathValidationResult,
  DiagnosticsLogLevel,
  MinicoConfig,
  SettingsSnapshot,
} from "../../core/settings/types";
import { WorkspacePicker } from "./WorkspacePicker";

const logLevels: DiagnosticsLogLevel[] = ["error", "warn", "info", "debug"];
const codexPersonalities: CodexPersonality[] = [
  "friendly",
  "pragmatic",
  "none",
];
const appThemes: AppTheme[] = ["light", "dark"];
const DEFAULT_CODEX_HOME_ALIAS = "~/.codex";

function normalizeCodexPath(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkspacePath(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCodexHomePath(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_CODEX_HOME_ALIAS;
}

function resolveCodexHomeDialogDefaultPath(
  inputValue: string,
  effectiveCodexHome: string | null,
): string | undefined {
  const trimmed = inputValue.trim();
  if (trimmed.length === 0) {
    return effectiveCodexHome ?? DEFAULT_CODEX_HOME_ALIAS;
  }
  if (trimmed.startsWith("~")) {
    return effectiveCodexHome ?? trimmed;
  }
  return trimmed;
}

function resolveCodexHomeInputValue(
  configuredHomePath: string | null | undefined,
  effectiveCodexHome: string | null,
): string {
  const normalized = normalizeCodexHomePath(configuredHomePath ?? "");
  if (normalized.startsWith("~") && effectiveCodexHome) {
    return effectiveCodexHome;
  }
  return normalized;
}

interface SettingsViewProps {
  onSaved?: (config: MinicoConfig) => void;
}

export function SettingsView({ onSaved }: SettingsViewProps) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [config, setConfig] = useState<MinicoConfig | null>(null);
  const [codexPathInput, setCodexPathInput] = useState("");
  const [codexHomeInput, setCodexHomeInput] = useState("");
  const [workspacePathInput, setWorkspacePathInput] = useState("");
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState<string | null>(
    null,
  );
  const [validation, setValidation] = useState<CodexPathValidationResult | null>(
    null,
  );
  const [workspaceWarning, setWorkspaceWarning] = useState<string | null>(null);
  const [diagnosticsToast, setDiagnosticsToast] = useState<{
    message: string;
    token: number;
  } | null>(null);
  const [isDiagnosticsToastClosing, setIsDiagnosticsToastClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingSaveConfigRef = useRef<MinicoConfig | null>(null);
  const savingInFlightRef = useRef(false);

  function showSettingsToast(message: string) {
    setDiagnosticsToast({
      message,
      token: Date.now(),
    });
  }

  useEffect(() => {
    async function bootstrap() {
      try {
        const loaded = await loadSettings();
        const defaultWorkspace = await loadDefaultWorkspacePath();
        const resolvedWorkspace = await resolveActiveCwd();
        const effectiveWorkspacePath = resolvedWorkspace.fallbackUsed
          ? resolvedWorkspace.cwd
          : (loaded.config.workspace.lastPath ?? defaultWorkspace);
        const normalizedConfig: MinicoConfig = {
          ...loaded.config,
          workspace: {
            ...loaded.config.workspace,
            lastPath: effectiveWorkspacePath,
          },
        };
        setSnapshot(loaded);
        setConfig(normalizedConfig);
        setCodexPathInput(loaded.config.codex.path ?? "");
        setCodexHomeInput(
          resolveCodexHomeInputValue(
            loaded.config.codex.homePath,
            loaded.effectiveCodexHome ?? null,
          ),
        );
        setWorkspacePathInput(effectiveWorkspacePath);
        setDefaultWorkspacePath(defaultWorkspace);
        setWorkspaceWarning(resolvedWorkspace.warning);
      } catch (loadError) {
        setError(String(loadError));
      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    if (!diagnosticsToast) {
      return;
    }
    setIsDiagnosticsToastClosing(false);
    const closeTimeoutId = window.setTimeout(() => {
      setIsDiagnosticsToastClosing(true);
    }, 2700);
    const removeTimeoutId = window.setTimeout(() => {
      setDiagnosticsToast(null);
      setIsDiagnosticsToastClosing(false);
    }, 3000);
    return () => {
      window.clearTimeout(closeTimeoutId);
      window.clearTimeout(removeTimeoutId);
    };
  }, [diagnosticsToast?.token]);

  function composeConfig(
    baseConfig: MinicoConfig,
    overrides?: {
      codexPathInputValue?: string;
      codexHomeInputValue?: string;
      workspacePathInputValue?: string;
    },
  ): MinicoConfig {
    const codexPathValue = overrides?.codexPathInputValue ?? codexPathInput;
    const codexHomeValue = overrides?.codexHomeInputValue ?? codexHomeInput;
    const workspaceValue =
      overrides?.workspacePathInputValue ?? workspacePathInput;
    return {
      ...baseConfig,
      codex: {
        ...baseConfig.codex,
        path: normalizeCodexPath(codexPathValue),
        homePath: normalizeCodexHomePath(codexHomeValue),
      },
      workspace: {
        ...baseConfig.workspace,
        lastPath: normalizeWorkspacePath(workspaceValue),
      },
    };
  }

  function areConfigsEqual(left: MinicoConfig, right: MinicoConfig): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  async function flushSaveQueue() {
    if (savingInFlightRef.current) {
      return;
    }
    savingInFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      while (pendingSaveConfigRef.current) {
        const nextConfig = pendingSaveConfigRef.current;
        pendingSaveConfigRef.current = null;

        const validationResult = await validateCodexPath(nextConfig.codex.path);
        setValidation(validationResult);
        if (!validationResult.valid) {
          continue;
        }

        const updated = await saveSettings(nextConfig);
        setSnapshot(updated);
        setConfig(updated.config);
        setCodexPathInput(updated.config.codex.path ?? "");
        setCodexHomeInput(
          resolveCodexHomeInputValue(
            updated.config.codex.homePath,
            updated.effectiveCodexHome ?? null,
          ),
        );
        setWorkspacePathInput(
          updated.config.workspace.lastPath ?? defaultWorkspacePath ?? "",
        );
        onSaved?.(updated.config);
      }
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      savingInFlightRef.current = false;
      setSaving(false);
    }
  }

  function queueSave(nextConfig: MinicoConfig) {
    if (!config) {
      return;
    }
    if (areConfigsEqual(nextConfig, config)) {
      return;
    }
    pendingSaveConfigRef.current = nextConfig;
    void flushSaveQueue();
  }

  function onCodexPathBlur() {
    if (!config) {
      return;
    }
    const nextConfig = composeConfig(config);
    queueSave(nextConfig);
  }

  function onCodexHomeBlur() {
    if (!config) {
      return;
    }
    const nextConfig = composeConfig(config);
    queueSave(nextConfig);
  }

  function onWorkspacePathBlur() {
    if (!config) {
      return;
    }
    const nextConfig = composeConfig(config);
    queueSave(nextConfig);
  }

  async function onExportDiagnostics() {
    setError(null);
    try {
      const exported = await exportDiagnosticsLogs();
      showSettingsToast(`Diagnostics log exported: ${exported.logPath}`);
    } catch (exportError) {
      setError(String(exportError));
    }
  }

  async function onPickCodexHomeFolder() {
    if (!config) {
      return;
    }
    const activePath = resolveCodexHomeDialogDefaultPath(
      codexHomeInput,
      snapshot?.effectiveCodexHome ?? null,
    );
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: activePath,
      });
      if (!picked) {
        return;
      }
      const selectedPath = Array.isArray(picked) ? picked[0] : picked;
      if (typeof selectedPath !== "string") {
        return;
      }
      const normalizedPath = selectedPath.trim();
      if (normalizedPath.length === 0) {
        return;
      }
      setCodexHomeInput(normalizedPath);
      const nextConfig = composeConfig(config, {
        codexHomeInputValue: normalizedPath,
      });
      queueSave(nextConfig);
    } catch (error) {
      console.warn("CODEX_HOME picker failed", error);
    }
  }

  function onResetCodexHomeDefault() {
    if (!config) {
      return;
    }
    const nextCodexHome = snapshot?.effectiveCodexHome ?? DEFAULT_CODEX_HOME_ALIAS;
    setCodexHomeInput(nextCodexHome);
    const nextConfig = composeConfig(config, {
      codexHomeInputValue: nextCodexHome,
    });
    queueSave(nextConfig);
    showSettingsToast(`CODEX_HOME reset to default: ${nextCodexHome}`);
  }

  function onResetWorkspaceDefault() {
    if (!config) {
      return;
    }
    const nextWorkspacePath = defaultWorkspacePath ?? workspacePathInput;
    setWorkspacePathInput(nextWorkspacePath);
    const nextConfig = composeConfig(config, {
      workspacePathInputValue: nextWorkspacePath,
    });
    queueSave(nextConfig);
    showSettingsToast(`Workspace path reset to default: ${nextWorkspacePath}`);
  }

  function onWorkspacePathBrowse(nextWorkspacePath: string) {
    if (!config) {
      return;
    }
    setWorkspacePathInput(nextWorkspacePath);
    const nextConfig = composeConfig(config, {
      workspacePathInputValue: nextWorkspacePath,
    });
    queueSave(nextConfig);
  }

  function onPersonalityChange(nextPersonality: CodexPersonality) {
    if (!config) {
      return;
    }
    const nextConfig = composeConfig({
      ...config,
      codex: {
        ...config.codex,
        personality: nextPersonality,
      },
    });
    setConfig(nextConfig);
    queueSave(nextConfig);
  }

  function onThemeChange(nextTheme: AppTheme) {
    if (!config) {
      return;
    }
    const nextConfig = composeConfig({
      ...config,
      appearance: {
        ...config.appearance,
        theme: nextTheme,
      },
    });
    setConfig(nextConfig);
    queueSave(nextConfig);
  }

  function onLogLevelChange(nextLogLevel: DiagnosticsLogLevel) {
    if (!config) {
      return;
    }
    const nextConfig = composeConfig({
      ...config,
      diagnostics: {
        ...config.diagnostics,
        logLevel: nextLogLevel,
      },
    });
    setConfig(nextConfig);
    queueSave(nextConfig);
  }

  if (!config || !snapshot) {
    return (
      <section className="status-card" aria-label="settings loading">
        <h2>Settings</h2>
        <p>Loading configuration...</p>
      </section>
    );
  }

  return (
    <section className="status-card" aria-label="settings form">
      <h2>Settings</h2>
      <div className="settings-form">
        <label htmlFor="codexPath">Codex executable path (optional)</label>
        <input
          id="codexPath"
          type="text"
          value={codexPathInput}
          onChange={(event) => setCodexPathInput(event.currentTarget.value)}
          onBlur={onCodexPathBlur}
          placeholder="Use PATH when empty"
        />

        <label htmlFor="codexHome">CODEX_HOME</label>
        <div className="codex-home-input-row">
          <input
            id="codexHome"
            type="text"
            value={codexHomeInput}
            onChange={(event) => setCodexHomeInput(event.currentTarget.value)}
            onBlur={onCodexHomeBlur}
            placeholder="~/.codex"
          />
          <button
            type="button"
            className="icon-button icon-button-muted codex-home-action"
            onClick={() => void onPickCodexHomeFolder()}
            aria-label="Browse CODEX_HOME folder"
            title="Browse CODEX_HOME folder"
          >
            <FolderOpen size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button icon-button-muted codex-home-action"
            onClick={onResetCodexHomeDefault}
            aria-label="Use default CODEX_HOME"
            title="Use default CODEX_HOME"
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        </div>

        <WorkspacePicker
          value={workspacePathInput}
          defaultPath={defaultWorkspacePath}
          onChange={setWorkspacePathInput}
          onBlur={onWorkspacePathBlur}
          onBrowseSelect={onWorkspacePathBrowse}
          onUseDefault={onResetWorkspaceDefault}
        />

        <label htmlFor="personality">Codex personality</label>
        <select
          id="personality"
          value={config.codex.personality}
          onChange={(event) =>
            onPersonalityChange(event.currentTarget.value as CodexPersonality)
          }
        >
          {codexPersonalities.map((personality) => (
            <option key={personality} value={personality}>
              {personality}
            </option>
          ))}
        </select>

        <label htmlFor="theme">Theme</label>
        <select
          id="theme"
          value={config.appearance.theme}
          onChange={(event) =>
            onThemeChange(event.currentTarget.value as AppTheme)
          }
        >
          {appThemes.map((theme) => (
            <option key={theme} value={theme}>
              {theme}
            </option>
          ))}
        </select>

        <label htmlFor="logLevel">Diagnostics log level</label>
        <div className="settings-inline-row">
          <select
            id="logLevel"
            value={config.diagnostics.logLevel}
            onChange={(event) =>
              onLogLevelChange(event.currentTarget.value as DiagnosticsLogLevel)
            }
          >
            {logLevels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button icon-button-muted settings-inline-action"
            onClick={() => void onExportDiagnostics()}
            disabled={saving}
            aria-label="Export diagnostics"
            title="Export diagnostics"
          >
            <FileDown size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {validation && !validation.valid && validation.message ? (
        <p className="form-error">{validation.message}</p>
      ) : null}
      {workspaceWarning ? <p className="form-warning">{workspaceWarning}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {diagnosticsToast ? (
        <div
          className={`settings-toast${isDiagnosticsToastClosing ? " is-closing" : ""}`}
          role="status"
          aria-live="polite"
        >
          {diagnosticsToast.message}
        </div>
      ) : null}
    </section>
  );
}
