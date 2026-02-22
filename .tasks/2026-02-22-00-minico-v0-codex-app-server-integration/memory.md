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
