import { FormEvent, useEffect, useState } from "react";

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

function normalizeCodexPath(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkspacePath(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface SettingsViewProps {
  onSaved?: (config: MinicoConfig) => void;
}

export function SettingsView({ onSaved }: SettingsViewProps) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [config, setConfig] = useState<MinicoConfig | null>(null);
  const [codexPathInput, setCodexPathInput] = useState("");
  const [workspacePathInput, setWorkspacePathInput] = useState("");
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState<string | null>(
    null,
  );
  const [validation, setValidation] = useState<CodexPathValidationResult | null>(
    null,
  );
  const [workspaceWarning, setWorkspaceWarning] = useState<string | null>(null);
  const [diagnosticsExportPath, setDiagnosticsExportPath] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
        setWorkspacePathInput(effectiveWorkspacePath);
        setDefaultWorkspacePath(defaultWorkspace);
        setWorkspaceWarning(resolvedWorkspace.warning);
      } catch (loadError) {
        setError(String(loadError));
      }
    }

    void bootstrap();
  }, []);

  async function onValidatePath() {
    const result = await validateCodexPath(normalizeCodexPath(codexPathInput));
    setValidation(result);
    return result;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const validationResult = await onValidatePath();
      if (!validationResult.valid) {
        setSaving(false);
        return;
      }

      const nextConfig: MinicoConfig = {
        ...config,
        codex: {
          ...config.codex,
          path: normalizeCodexPath(codexPathInput),
        },
        workspace: {
          ...config.workspace,
          lastPath: normalizeWorkspacePath(workspacePathInput),
        },
      };
      const updated = await saveSettings(nextConfig);
      setSnapshot(updated);
      setConfig(updated.config);
      setCodexPathInput(updated.config.codex.path ?? "");
      setWorkspacePathInput(
        updated.config.workspace.lastPath ?? defaultWorkspacePath ?? "",
      );
      onSaved?.(updated.config);
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function onExportDiagnostics() {
    setError(null);
    try {
      const exported = await exportDiagnosticsLogs();
      setDiagnosticsExportPath(exported.logPath);
    } catch (exportError) {
      setError(String(exportError));
    }
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
      <form className="settings-form" onSubmit={onSubmit}>
        <label htmlFor="codexPath">Codex executable path (optional)</label>
        <input
          id="codexPath"
          type="text"
          value={codexPathInput}
          onChange={(event) => setCodexPathInput(event.currentTarget.value)}
          placeholder="Use PATH when empty"
        />

        <WorkspacePicker
          value={workspacePathInput}
          defaultPath={defaultWorkspacePath}
          onChange={setWorkspacePathInput}
          onUseDefault={() =>
            setWorkspacePathInput(defaultWorkspacePath ?? workspacePathInput)
          }
        />

        <label className="checkbox-row" htmlFor="homeIsolation">
          <input
            id="homeIsolation"
            type="checkbox"
            checked={config.codex.homeIsolation}
            onChange={(event) =>
              setConfig({
                ...config,
                codex: {
                  ...config.codex,
                  homeIsolation: event.currentTarget.checked,
                },
              })
            }
          />
          <span>Enable CODEX_HOME isolation</span>
        </label>

        <label htmlFor="personality">Codex personality</label>
        <select
          id="personality"
          value={config.codex.personality}
          onChange={(event) =>
            setConfig({
              ...config,
              codex: {
                ...config.codex,
                personality: event.currentTarget.value as CodexPersonality,
              },
            })
          }
        >
          {codexPersonalities.map((personality) => (
            <option key={personality} value={personality}>
              {personality}
            </option>
          ))}
        </select>

        <label htmlFor="logLevel">Diagnostics log level</label>
        <select
          id="logLevel"
          value={config.diagnostics.logLevel}
          onChange={(event) =>
            setConfig({
              ...config,
              diagnostics: {
                logLevel: event.currentTarget.value as DiagnosticsLogLevel,
              },
            })
          }
        >
          {logLevels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>

        <div className="settings-actions">
          <button
            type="button"
            onClick={() => void onExportDiagnostics()}
            disabled={saving}
          >
            Export diagnostics
          </button>
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </form>

      <p>
        Config file: <strong>{snapshot.configPath}</strong>
      </p>
      <p>
        Effective CODEX_HOME:{" "}
        <strong>{snapshot.effectiveCodexHome ?? "(default ~/.codex)"}</strong>
      </p>
      {validation && !validation.valid && validation.message ? (
        <p className="form-error">{validation.message}</p>
      ) : null}
      {diagnosticsExportPath ? (
        <p>
          Diagnostics log exported: <strong>{diagnosticsExportPath}</strong>
        </p>
      ) : null}
      {workspaceWarning ? <p className="form-warning">{workspaceWarning}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
