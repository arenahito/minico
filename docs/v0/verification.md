# Minico V0 Verification Guide

This document is the manual verification checklist for V0.
Follow steps in order and record pass/fail evidence.

## 1. Automated Verification

Run from repository root:

```powershell
pnpm lint
pnpm test
pnpm typecheck
pnpm rust:fmt
pnpm rust:clippy
pnpm rust:test
pnpm tauri build --debug --no-bundle
```

Expected result:

- All commands exit successfully.
- No lint/type/clippy errors.

## 2. Startup and Handshake

1. Launch app:
   - `pnpm tauri dev`
2. Confirm window opens and no immediate error banner appears.
3. If logged out, Login view appears with ChatGPT login button.
4. If already logged in with ChatGPT, thread/chat shell is visible.

Expected result:

- `initialize -> initialized` path is successful.
- App does not crash if no existing threads.

## 3. ChatGPT Login Flow

1. Start from logged-out state.
2. Click `Continue with ChatGPT`.
3. Browser opens OAuth URL.
4. Complete login.
5. Return to app and wait for notification transition.

Expected result:

- UI transitions to logged-in chat shell without app restart.

## 4. Unsupported API-Key Guard

1. Reproduce API-key account mode in Codex context.
2. Launch Minico.
3. Confirm unsupported message is shown.
4. Click `Logout and continue`.

Expected result:

- User cannot proceed while API-key mode is active.
- After logout, login-required flow is available.

## 5. Thread and Turn Flow

1. Click `+ New thread`.
2. Send prompt in composer.
3. Observe streaming updates:
   - `turn/started`
   - `item/started`
   - `item/agentMessage/delta`
   - `item/completed`
   - `turn/completed`
4. Use `Refresh` and verify thread is listed.
5. Select an existing thread and confirm resume path works.

Expected result:

- `thread/list` is app-server scoped.
- Streaming text appears incrementally and completion clears active turn.

## 6. Interrupt Flow

1. Start a long response turn.
2. Click `Interrupt turn`.

Expected result:

- `turn/interrupt` is sent.
- Active turn indicator is cleared.

## 7. Approval Flow

1. Trigger command approval.
2. Confirm dialog shows command context (`command`, `cwd`, `reason`).
3. Test decision buttons:
   - Accept
   - Accept for session
   - Decline
   - Cancel
4. Trigger file-change approval.
5. Confirm file-change preview is rendered.

Expected result:

- Decision response is correlated to incoming request ID.
- No auto-approval occurs without explicit action.
- If approval cannot be presented in active auth context, fallback `cancel` is used.

## 8. Home Isolation Behavior

1. Open Settings.
2. Enable `CODEX_HOME isolation`.
3. Save settings and restart app.

Expected result:

- Effective `CODEX_HOME` points to `~/.minico/codex`.
- Minico does not create or edit `config.toml`.

## 9. Window Placement Safety

1. Move and resize app window.
2. Restart app and confirm placement restore.
3. Repeat with monitor topology change or scale change.

Expected result:

- Restored window remains visible and clamped to monitor work area.
- Maximized restore is applied after safe size/position restoration.

## 10. Diagnostics and Error UX

1. Set diagnostics log level (`error`, `warn`, `info`, `debug`) and save.
2. Trigger a handled error (invalid codex path or overload simulation).
3. Confirm ErrorBanner shows actionable guidance.
4. Click `Export diagnostics` in Settings.
5. Record exported file path for bug report.

Expected result:

- Error messages are mapped to user-facing guidance, not raw stack dumps.
- Diagnostics log file is generated under `.minico/logs`.

