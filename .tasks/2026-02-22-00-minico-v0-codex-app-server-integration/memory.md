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
