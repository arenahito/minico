# Minico V0 Error Catalog

This catalog defines user-facing errors for Minico V0.
Each entry includes trigger condition, banner message direction, and recovery action.

## `codex_spawn_failed`

- Trigger:
  - `codex app-server` process cannot be spawned.
  - Typical causes: Codex not installed, invalid `codex.path`, no executable permission.
- User message:
  - "Codex executable was not found."
- Recovery:
  - Install Codex CLI or fix `Settings > Codex executable path`.
  - Clear `codex.path` to fall back to PATH lookup.

## `handshake_not_ready`

- Trigger:
  - Requests are attempted before `initialize -> initialized` handshake completes.
- User message:
  - "Codex session is not ready."
- Recovery:
  - Retry startup.
  - Restart Minico if handshake does not recover.

## `unauthorized`

- Trigger:
  - Backend reports Unauthorized error for account-guarded calls.
- User message:
  - "Authorization expired."
- Recovery:
  - Return to login screen and complete ChatGPT OAuth again.

## `overloaded`

- Trigger:
  - App-server returns overload (`-32001`) until retry budget is exhausted.
- User message:
  - "Codex is currently overloaded."
- Recovery:
  - Wait briefly and retry the same action.

## `invalid_codex_path`

- Trigger:
  - `settings_validate_codex_path` rejects configured path.
- User message:
  - "Configured codex path is invalid."
- Recovery:
  - Select an existing executable path, or clear the field to use PATH mode.

## `unknown_error`

- Trigger:
  - Error does not match known categories.
- User message:
  - "Unexpected error."
- Recovery:
  - Retry action.
  - Export diagnostics log and include the file when reporting a bug.

## Diagnostics Log Levels

Minico stores log level in `diagnostics.logLevel`:

- `error`: only failure conditions are expected in diagnostics output.
- `warn`: error + recoverable warnings.
- `info`: warn + lifecycle status (startup, reconnect, restore flows).
- `debug`: info + verbose integration traces.

At runtime, app-server stderr can be exported from Settings via `Export diagnostics`.
The exported file path is printed in the Settings panel for bug reports.

