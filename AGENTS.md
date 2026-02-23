# AGENTS

This file defines repository-specific guardrails for all agents working on `minico`.

## Product Intent

- Keep minico usable for end users first.
- Prefer responsive behavior over hidden background work.
- Make state transitions obvious in UI.

## Core Runtime Rules

- Never block UI during network or app-server operations.
  Polling, auth checks, thread operations, and model loading must be async and non-blocking.
- Treat app-server notifications as eventually ordered signals.
  If correctness depends on final truth (auth/session/thread state), include a re-read path.
- Prevent overlapping poll loops.
  Poll execution must remain single-flight.
- Keep reducer boundaries strict.
  Ignore malformed payloads and preserve current state on invalid events.

## Auth and Startup Rules

- Startup must show explicit progress while checking app-server and account state.
- Login flow is ChatGPT OAuth only.
- In login-required view:
  - `CODEX_HOME` can be edited.
  - Persist `CODEX_HOME` before starting login.
  - Then start browser login.
- Do not reintroduce manual "Retry status check" actions in login-required UX unless explicitly requested.

## Thread and Turn Rules

- Creating a new thread in UI does not start a backend thread immediately.
  Backend `thread_start` happens on the first user prompt.
- Refresh thread list after first assistant response so title/preview can appear.
- Selecting a thread should update UI immediately, then hydrate history asynchronously.
- Keep unknown/system-only items hidden unless explicitly needed by product requirement.

## Model and Effort Rules

- Persist selected model and effort in window settings.
- On startup, restore persisted model/effort without overwriting them with transient defaults.
- Do not persist `null` effort during pre-restore bootstrap races.

## CODEX_HOME Rules

- Default alias is `~/.minico/codex`.
- Expanded display path should remain stable when default is active.
  Repeated reset actions must not degrade displayed value back to raw alias unexpectedly.
- When effective `CODEX_HOME` changes, reset runtime cleanly before continuing operations that depend on it.

## Approval Flow Safety

- Keep approval UX retryable.
  Pending approval requests stay visible until backend acknowledgment is confirmed.
- Fallback approval decisions are safety mechanisms, not replacements for user intent.
- If both primary and fallback responses fail, preserve pending request and provide recovery guidance.
- Auto-resolution is allowed only when approval UI cannot be shown, and failures must remain recoverable.

## UI/UX Consistency Rules

- All user-facing text must be English.
- Keep chat behavior consistent with current product decisions:
  - LINE-like left/right bubbles
  - minico naming (do not use "agent" in UI labels)
  - thinking indicator in assistant lane
- Keep app layout non-scrolling at window level.
  Scroll only inside intended panes.

## Diagnostics and Error UX

- Diagnostics level changes must have observable runtime effect.
- Export diagnostics must produce clear user feedback.
- User-facing errors should be actionable and stable.
  Preserve raw details in diagnostics output.

## Testing Expectations

- After implementing changes, running `pnpm verify` is mandatory before handoff.
- Add or update tests for behavior changes, not only happy paths.
- Include coverage for:
  - auth state recovery
  - poll overlap guard behavior
  - approval retryability/fallback
  - model/effort restore and persistence race conditions
  - CODEX_HOME save/reset edge cases

## Commit Message Rules

- Write commit messages using Conventional Commits.
- Preferred format: `type(scope): summary`
- Examples:
  - `fix(auth): prevent stale initialized state after recovery failure`
  - `feat(ci): add release-please workflow`
