# Minico V0 Codex App-Server Integration Implementation

## X1: Bootstrap Desktop Workspace and Build Baseline

### Tooling: Scaffold in a non-empty repository

**Context**: The repository already contained `specs/` and `.tasks/`, so direct `create-tauri-app` initialization at root failed.

**Problem**: `create-tauri-app` aborts when the target directory is not empty, which blocks bootstrap in documentation-first repositories.

**Resolution**: Generated scaffold in a temporary directory and copied it into root:

```powershell
pnpm dlx create-tauri-app@latest "_bootstrap" --template react-ts --manager pnpm --yes
robocopy "_bootstrap" "." /E /NFL /NDL /NJH /NJS /NP /XD "node_modules"
cmd /c rmdir /s /q "_bootstrap"
```

**Scope**: `codebase`

### Tooling: Keep Rust and TypeScript quality gates symmetrical

**Context**: The initial scaffold only provided frontend scripts and no Rust lint/format command wiring.

**Problem**: Baseline verification was incomplete for a mixed Rust + TypeScript desktop application.

**Resolution**: Added explicit Rust scripts in `package.json` and included them in README verification flow:

```json
"rust:fmt": "cargo fmt --manifest-path src-tauri/Cargo.toml --check",
"rust:clippy": "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings",
"rust:test": "cargo test --manifest-path src-tauri/Cargo.toml"
```

**Scope**: `codebase`

### Design: Placeholder core modules should avoid warning noise

**Context**: X1 introduced placeholder modules (`app_server_process`, `rpc_client`, `lifecycle`) ahead of functional implementation in later tasks.

**Problem**: Rust emitted dead-code warnings in build/test outputs, reducing signal during CI checks.

**Resolution**: Added targeted `#[allow(dead_code)]` on placeholder items and kept behavior-tested constructors/methods so warning-free pipelines remain strict where it matters.

**Scope**: `task-specific`

## X2: Implement MinicoConfig and Codex Path/Home Isolation Policy

### Configuration: Preserve unknown fields during settings roundtrip

**Context**: X2 required forward compatibility for settings schema while still allowing typed access in Rust and TypeScript.

**Problem**: A plain typed struct drops unknown JSON keys when re-serialized, which can remove future settings after one save operation.

**Resolution**: Added `#[serde(flatten)] extra: HashMap<String, serde_json::Value>` at root and nested config structs, then added a roundtrip test that parses unknown keys and verifies they remain after `save()` writes config back.

**Scope**: `codebase`

### Error Handling: Separate read and write IO failures for user diagnostics

**Context**: Settings APIs return error messages directly to UI in this phase.

**Problem**: Reusing one IO error variant made write failures appear as read failures, reducing the quality of troubleshooting guidance.

**Resolution**: Split IO errors into `ReadConfig` and `WriteConfig`, mapping `read_to_string` to `ReadConfig` and `create_dir_all`/`write` to `WriteConfig`.

**Scope**: `codebase`

### Testing: UI validation should prove save blocking behavior

**Context**: The settings form validates `codex.path` before persisting changes.

**Problem**: It is easy to accidentally still call save after a failed validation when refactoring form submit flow.

**Resolution**: Added `SettingsView` test case that mocks invalid validation result and asserts `saveSettings` is not called while the validation error message is displayed.

**Scope**: `task-specific`

## X4: Implement Workspace Selection and CWD Resolution

### Reliability: Keep workspace resolution independent from codex path validity

**Context**: Workspace resolver persists fallback path when stored workspace becomes unavailable.

**Problem**: Reusing the normal settings save path made fallback persistence fail when `codex.path` was invalid, even though `cwd` resolution itself could succeed.

**Resolution**: Added `save_system_update` in config layer for internal state persistence without `codex.path` validation and used it from workspace fallback handling.

**Scope**: `codebase`

### UX: Distinguish first-run fallback from broken stored workspace

**Context**: Resolver always returned `fallbackUsed=true` when no selected workspace existed.

**Problem**: Showing a fixed "stored path unavailable" warning on first launch was misleading because no stored path existed.

**Resolution**: Resolver now emits warning only when a non-empty stored workspace path existed and failed validation. First-run fallback keeps `warning = None`.

**Scope**: `codebase`

### State Management: Prevent stale workspace path from being re-saved

**Context**: Settings view loaded persisted config and workspace resolver output separately.

**Problem**: After fallback, UI could keep an old unavailable path in local state and write it back on the next save, causing repeated fallback cycles.

**Resolution**: Settings bootstrap now computes an `effectiveWorkspacePath` from resolver output and writes it into local config/input state before save actions.

**Scope**: `task-specific`

## B1: Build AppServerProcess and JSON-RPC Transport Core

### Transport: Test concurrent request correlation with out-of-order responses

**Context**: The RPC transport uses `id -> pending` mapping and asynchronous reader dispatch.

**Problem**: Single-message tests can pass even when concurrent requests break due to race conditions or incorrect pending cleanup.

**Resolution**: Added a concurrency test using custom in-memory reader/writer pipes that sends multiple requests in parallel and returns responses in reverse order. The test asserts each worker receives the matching payload for its own request id.

**Scope**: `codebase`

### Robustness: Treat malformed JSONL as a recoverable stream event

**Context**: app-server communication is line-delimited JSON where partial or malformed lines can appear during failures.

**Problem**: If malformed lines terminate processing, valid subsequent messages are dropped and UI appears frozen.

**Resolution**: Reader thread now emits `RpcEvent::MalformedLine` and continues reading. Added a transport-level test proving a valid notification still arrives after a malformed line.

**Scope**: `codebase`

### Error Taxonomy: Use operation-specific process lifecycle errors

**Context**: Process lifecycle errors are surfaced to diagnostics and user-facing logs.

**Problem**: Mapping `kill()` failures to `Spawn` errors obscures the real failure phase and complicates debugging.

**Resolution**: Added `AppServerProcessError::Terminate` and mapped termination failures explicitly.

**Scope**: `codebase`

## B2: Implement CodexFacade Handshake, Retry, and Recovery

### Lifecycle: Recovery failures must not deadlock future retries

**Context**: `CodexFacade` transitions to `Recovering` when runtime process health check fails.

**Problem**: If restart or re-handshake fails once, leaving state at `Recovering` causes all following requests to fail fast as not initialized, even when next retry could succeed.

**Resolution**: `ensure_ready` now stores previous lifecycle state and rolls back on recovery failure paths, so subsequent calls can attempt recovery again.

**Scope**: `codebase`

### Reliability: Explicitly test overload exhaustion behavior

**Context**: Retry behavior on `-32001` overload is safety-critical because it controls user-facing failure semantics under server pressure.

**Problem**: Success-after-retry tests alone do not prove bounded failure behavior when overload persists.

**Resolution**: Added `returns_overloaded_when_retry_budget_is_exhausted` test, validating facade returns `CodexFacadeError::Overloaded` after max attempts.

**Scope**: `codebase`

### Architecture: Separate runtime transport and facade policy for isolated testing

**Context**: Handshake and recovery logic are stateful and easier to break than low-level transport code.

**Problem**: Testing policy logic directly against spawned child processes is slow and brittle.

**Resolution**: Introduced `RpcRuntime` trait and `MockRuntime` tests to validate handshake gating, retry, and restart policy without external process dependencies.

**Scope**: `codebase`

## X3: Implement Safe Window Placement Persistence

### DPI Safety: Keep persisted and restored window coordinates in the same unit

**Context**: Window placement is persisted from Tauri `outerPosition()`/`outerSize()`, which are physical-pixel values.

**Problem**: Restoring with `LogicalPosition`/`LogicalSize` mixes unit systems and can misplace windows after DPI/scaling changes.

**Resolution**: Switched restoration apply step to `PhysicalPosition`/`PhysicalSize` so persisted values and restored values use a consistent physical unit model.

**Scope**: `codebase`

### Multi-Monitor UX: Use monitor work area instead of full monitor bounds

**Context**: The restoration clamp logic receives monitor rectangles from frontend and runs in Rust.

**Problem**: Using full monitor `position/size` ignores reserved OS UI areas (taskbar/dock/menu bar), allowing restored windows to overlap non-usable screen space.

**Resolution**: Updated monitor mapping to prefer `monitor.workArea.position/size` (with fallback to full bounds) before invoking `window_restore_placement`, and extended the lifecycle test to assert this mapping.

**Scope**: `task-specific`

## B3: Implement ChatGPT-Only Authentication State Machine

### Auth State: Re-check account status immediately after login completion notification

**Context**: `account/login/completed` can arrive before an `account/updated` notification, depending on app-server timing.

**Problem**: If UI only moved to a transient `checking` state and waited for `account/updated`, login flow could stall even after successful browser OAuth.

**Resolution**: Added an explicit `auth_read_status` re-fetch when `account/login/completed` indicates success. This guarantees deterministic transition to `loggedIn`/`loginRequired` without requiring a second notification.

**Scope**: `codebase`

### Policy Guard: API-key auth must be blocked with an explicit logout recovery path

**Context**: Shared Codex home (`homeIsolation=false`) can expose existing API-key sessions created by CLI/IDE.

**Problem**: Treating any authenticated account as valid would violate the product policy (ChatGPT OAuth only).

**Resolution**: Added backend auth mapping (`auth_read_status`) and frontend `LoginView` branch for `unsupportedApiKey`, with a `auth_logout_and_read` action that returns the user to ChatGPT login flow.

**Scope**: `codebase`

## B4: Implement Thread/Turn Orchestration and Streaming Model

### Event Loop: Prevent overlapping poll calls when backend latency spikes

**Context**: Session polling runs on an interval and calls `session_poll_events`.

**Problem**: Without an in-flight guard, slow responses can overlap with the next interval tick, causing duplicated processing and racey UI state transitions.

**Resolution**: Added `pollInFlightRef` guard in `AppShell` so only one poll request can execute at a time. Later ticks are skipped until the active poll resolves.

**Scope**: `codebase`

### Reducer Safety: Enforce strict payload guards for app-server notifications

**Context**: Notification payloads are dynamic JSON and can be malformed during version mismatch or transport corruption.

**Problem**: Converting unknown fields with `String(...)` silently accepts invalid types and pollutes reducer state.

**Resolution**: Tightened type guards in `eventToTurnAction` to require exact string fields (`threadId`, `turn.id`, `item.id`, `delta`) and return `null` for malformed payloads. Added malformed-input unit tests.

**Scope**: `codebase`

## F1: Build Core UI Screens and Session Wiring

### Session Wiring: Keep UI modular by splitting command wrappers, state machines, and presentational components

**Context**: End-to-end V0 flow spans login, thread list, streaming chat, settings, and error banner behavior.

**Problem**: Embedding backend invoke calls directly in view components makes branch behavior hard to test and brittle under protocol changes.

**Resolution**: Separated concerns into `authMachine`, `threadService`, `turnReducer`, and presentational components (`LoginView`, `ThreadListPanel`, `ChatView`). `AppShell` orchestrates flows while tests focus on module-specific branches.

**Scope**: `codebase`

## F2: Implement Approval Dialogs and Decision Response Bridge

### Reliability: Never drop pending approval when both response and fallback fail

**Context**: Approval decisions are safety-critical and must be correlated to server request IDs.

**Problem**: Clearing local approval queue unconditionally in `finally` can lose pending requests if both primary response and fallback cancel fail.

**Resolution**: Queue entries are now removed only after a confirmed successful send (`accept/decline/...` or fallback `cancel`). On dual-failure, request stays visible so user can retry.

**Scope**: `codebase`

### Fallback Rule: Auto-cancel only when dialog presentation is impossible

**Context**: Approval may arrive while app is not in a state that can present the dialog (e.g., not logged in).

**Problem**: Ignoring request violates protocol expectations; immediate dequeue on failed cancel violates explicit consent guarantees.

**Resolution**: Added auth-gated auto-cancel path with in-flight dedupe. Auto-cancel removes queue entry only when backend send succeeds.

**Scope**: `task-specific`

## D1: Add Diagnostics, Error UX, and End-to-End Verification Guide

### Diagnostics: Apply stored log level at export time for predictable bug report payloads

**Context**: V0 stores `diagnostics.logLevel` in settings and exposes diagnostics export from the settings screen.

**Problem**: Exporting raw stderr unfiltered makes log-level selection meaningless and breaks operator expectations.

**Resolution**: Added `filter_diagnostics_lines` in Rust export path (`diagnostics_export_logs`) and mapped behavior by configured level (`error`, `warn`, `info`, `debug`). Export writes logs under `.minico/logs/diagnostics-<timestamp>.log`.

**Scope**: `codebase`

### Error UX: Standardize mapping from technical failures to actionable user guidance

**Context**: Runtime failures span spawn issues, auth expiry, overload, and unknown transport faults.

**Problem**: Raw error strings are hard to act on and inconsistent across screens.

**Resolution**: Added `errorMapper` + `ErrorBanner` with stable error codes, concise titles, and concrete recovery actions. Documented mappings and full E2E verification in `docs/v0/error-catalog.md` and `docs/v0/verification.md`.

**Scope**: `codebase`
