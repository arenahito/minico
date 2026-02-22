import { invoke } from "@tauri-apps/api/core";

export interface DiagnosticsExportResult {
  logPath: string;
  lineCount: number;
}

export async function exportDiagnosticsLogs(): Promise<DiagnosticsExportResult> {
  return invoke<DiagnosticsExportResult>("diagnostics_export_logs");
}

