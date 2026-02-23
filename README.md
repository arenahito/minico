# minico

Your personal desktop AI companion—simple, smart, and easy to use.

> [!IMPORTANT]
> **Early Development**: minico is currently in active development. Features may change, and you might encounter bugs. We appreciate your feedback!

minico provides a seamless local chat experience with instant model switching, easy file attachments, and workspace-aware turns.

## What is minico?

minico is a desktop app that makes chatting with AI simple and organized. It’s designed to fit into your daily workflow without the complexity of traditional tools.

- **Instant Model Switching**: Quickly change models and reasoning effort to suit your task.
- **Smart Workspace Integration**: Keep your work context-aware with thread-specific directory settings.
- **Easy File Sharing**: Just drag and drop images or files to share them with the AI.
- **Clean & Simple**: A beautiful, intuitive interface designed for your daily workflow.
- **Personalized**: Customize the AI’s personality, app theme, and settings to make it yours.


## Getting Started

Before you begin, please ensure you have the [Codex CLI](https://github.com/openai/codex) installed on your computer. minico uses the Codex engine to power its conversations.

### First Launch

1. **Install Codex CLI**: Follow the instructions at the [Codex repository](https://github.com/openai/codex) to set it up.
2. **Launch minico**: Open the app and wait for the initial startup checks.
3. **Set Up Home**: On `Login required`, confirm your `CODEX_HOME` directory if prompted.
4. **Sign In**: Click `Continue with ChatGPT` to complete the login in your browser.
5. **Start Chatting**: Return to minico and you’re ready to go!

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

> [!NOTE]
> By default, minico uses isolated internal storage (`~/.minico/codex`) for its engine settings. This is separate from the standard Codex CLI location (`~/.codex`).
>
> If you want to use your existing Codex settings, you can change the `CODEX_HOME` path in the **Settings** dialog. Otherwise, you will need to complete the login/setup process again within minico.

Most settings can be changed from the Settings dialog and are saved immediately.


## For Developers

### Tech Stack

- Tauri v2 (Rust backend + desktop shell)
- React + TypeScript (frontend)
- Vitest + Testing Library (frontend tests)

### Requirements

- Node.js (LTS recommended)
- pnpm
- Rust toolchain (for Tauri build/run)
- Codex CLI available in `PATH` or configured explicitly in settings

### Setup & Run

```bash
# Clone and install dependencies
git clone <this-repository>
cd minico
pnpm install

# Run in development mode
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

