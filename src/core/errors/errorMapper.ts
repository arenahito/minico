export interface UserFacingError {
  title: string;
  message: string;
  recovery: string;
  code: string;
}

function asMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function mapErrorToUserFacing(error: unknown): UserFacingError {
  const raw = asMessage(error);

  if (raw.includes("Codex facade is not initialized")) {
    return {
      title: "Codex session is not ready",
      message: "The app-server handshake did not complete.",
      recovery: "Retry startup. If it persists, restart the app.",
      code: "handshake_not_ready",
    };
  }

  if (raw.includes("Failed to spawn app-server process")) {
    return {
      title: "Codex executable was not found",
      message:
        "minico could not start `codex app-server` with current settings.",
      recovery:
        "Install Codex CLI or set a valid executable path in Settings > Codex path.",
      code: "codex_spawn_failed",
    };
  }

  if (raw.includes("Configured codex path")) {
    return {
      title: "Configured codex path is invalid",
      message: raw,
      recovery:
        "Update Codex path to an existing executable file, or clear it to use PATH.",
      code: "invalid_codex_path",
    };
  }

  if (raw.includes("Unauthorized")) {
    return {
      title: "Authorization expired",
      message:
        "Your account session is not authorized for this request anymore.",
      recovery: "Use ChatGPT login again from the login screen.",
      code: "unauthorized",
    };
  }

  if (
    raw.includes("App-server overload persisted after retries") ||
    raw.includes("Overloaded")
  ) {
    return {
      title: "Codex is currently overloaded",
      message: "The request could not be processed after retries.",
      recovery: "Wait a moment and retry the same action.",
      code: "overloaded",
    };
  }

  return {
    title: "Unexpected error",
    message: raw,
    recovery: "Retry the action. If it keeps failing, export diagnostics logs.",
    code: "unknown_error",
  };
}

