import { FormEvent, useEffect, useState } from "react";

import {
  loadSettings,
  saveSettings,
  validateCodexPath,
} from "../../core/settings/store";
import type {
  CodexPathValidationResult,
  DiagnosticsLogLevel,
  MinicoConfig,
  SettingsSnapshot,
} from "../../core/settings/types";

const logLevels: DiagnosticsLogLevel[] = ["error", "warn", "info", "debug"];

function normalizeCodexPath(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function SettingsView() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [config, setConfig] = useState<MinicoConfig | null>(null);
  const [codexPathInput, setCodexPathInput] = useState("");
  const [validation, setValidation] = useState<CodexPathValidationResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      try {
        const loaded = await loadSettings();
        setSnapshot(loaded);
        setConfig(loaded.config);
        setCodexPathInput(loaded.config.codex.path ?? "");
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
      };
      const updated = await saveSettings(nextConfig);
      setSnapshot(updated);
      setConfig(updated.config);
      setCodexPathInput(updated.config.codex.path ?? "");
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSaving(false);
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
            onClick={() => void onValidatePath()}
            disabled={saving}
          >
            Validate path
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
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
