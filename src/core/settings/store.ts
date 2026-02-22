import { invoke } from "@tauri-apps/api/core";
import type {
  CodexPathValidationResult,
  MinicoConfig,
  SettingsSnapshot,
} from "./types";

export async function loadSettings(): Promise<SettingsSnapshot> {
  return invoke<SettingsSnapshot>("settings_read");
}

export async function saveSettings(
  config: MinicoConfig,
): Promise<SettingsSnapshot> {
  return invoke<SettingsSnapshot>("settings_write", { config });
}

export async function validateCodexPath(
  path: string | null,
): Promise<CodexPathValidationResult> {
  return invoke<CodexPathValidationResult>("settings_validate_codex_path", {
    path,
  });
}
