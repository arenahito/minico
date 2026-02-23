# minico

Friendly desktop chat client for Codex app-server.

minico focuses on a smooth local chat workflow with thread history, model/effort selection, file attachments, and workspace-aware turns.

## What is this?

minico is a Tauri desktop app that talks to `codex app-server` and provides a chat UI on top of it.

It is designed for everyday use:

- Chat with Codex from a desktop UI
- Manage thread history (refresh, load more, archive)
- Select model and reasoning effort from one control
- Attach files/images (picker + drag and drop)
- Override thread working directory per next turn
- Configure CODEX_HOME, workspace, personality, theme, and diagnostics level

## Requirements

- Node.js (LTS recommended)
- pnpm
- Rust toolchain (for Tauri build/run)
- Codex CLI available in `PATH` or configured explicitly in settings

## Installation

```bash
git clone <this-repository>
cd minico
pnpm install
```

## Run minico

```bash
pnpm tauri:dev
```

## First Launch

1. Wait for startup checks to complete.
2. On `Login required`, confirm `CODEX_HOME` if needed.
3. Click `Continue with ChatGPT` and complete browser login.
4. Return to minico and start chatting.

## Basic Usage

1. Create a new thread.
2. Choose model and effort from the model selector.
3. Type a prompt and send with:
   - `Enter` (send)
   - `Ctrl+Enter` (send)
4. Attach files from the paperclip button or by dropping files on the chat area.
5. If needed, set a thread-specific cwd from the folder button above the composer.

## Configuration

- Main config file: `~/.minico/config.json`
- Default `CODEX_HOME`: `~/.minico/codex`
- Default workspace: `~/.minico/workspace`

Most settings can be changed from the Settings dialog and are saved immediately.

## Diagnostics

- Export diagnostics logs from Settings.
- You can also change diagnostics log level from Settings.

## For Developers

### Tech Stack

- Tauri v2 (Rust backend + desktop shell)
- React + TypeScript (frontend)
- Vitest + Testing Library (frontend tests)

### Development Setup

```bash
pnpm install
pnpm tauri:dev
```

### Common Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm rust:fmt
pnpm rust:clippy
pnpm rust:test
pnpm tauri:build
```

### Additional Docs

- `docs/v0/verification.md`
- `docs/v0/error-catalog.md`
