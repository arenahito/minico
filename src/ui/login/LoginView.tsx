import { FolderOpen, RotateCcw } from "lucide-react";

import type { AuthMachineState } from "../../core/session/authMachine";

interface LoginViewProps {
  auth: AuthMachineState;
  busy: boolean;
  statusChecking: boolean;
  startupChecking: boolean;
  startupCheckSlow: boolean;
  codexHomeInput: string;
  onCodexHomeInputChange: (value: string) => void;
  onCodexHomeBlur: () => void;
  onPickCodexHomeFolder: () => void;
  onResetCodexHomeDefault: () => void;
  onStartLogin: () => void;
  onLogoutAndContinue: () => void;
}

export function LoginView({
  auth,
  busy,
  statusChecking,
  startupChecking,
  startupCheckSlow,
  codexHomeInput,
  onCodexHomeInputChange,
  onCodexHomeBlur,
  onPickCodexHomeFolder,
  onResetCodexHomeDefault,
  onStartLogin,
  onLogoutAndContinue,
}: LoginViewProps) {
  if (startupChecking) {
    return (
      <section className="login-card" aria-label="startup auth checking">
        <img
          className="chat-pane-loading-image login-startup-spinner"
          src="/minico500x500.png"
          alt="Preparing minico"
        />
        <h2>Preparing minico</h2>
        <p>Checking app-server connectivity and account status.</p>
        {startupCheckSlow ? (
          <p className="form-warning">
            This is taking longer than usual. minico will continue automatically
            when the check completes.
          </p>
        ) : (
          <p className="auth-progress">Please wait a moment...</p>
        )}
      </section>
    );
  }

  const actionDisabled = busy || statusChecking;
  const statusMessage = statusChecking
    ? "Checking account status in the background..."
    : null;

  if (auth.view === "unsupportedApiKey") {
    return (
      <section className="login-card" aria-label="auth unsupported">
        <h2>API key mode is not supported</h2>
        <p>
          minico supports ChatGPT managed OAuth only. Logout your current API key
          session and continue with ChatGPT login.
        </p>
        {statusMessage ? <p aria-live="polite">{statusMessage}</p> : null}
        <button type="button" onClick={onLogoutAndContinue} disabled={actionDisabled}>
          {busy ? "Logging out..." : "Logout and continue"}
        </button>
      </section>
    );
  }

  if (auth.view === "loginInProgress") {
    return (
      <section className="login-card" aria-label="auth login in progress">
        <h2>Complete login in browser</h2>
        <p>
          Waiting for <code>account/login/completed</code> notification...
        </p>
        {statusMessage ? <p aria-live="polite">{statusMessage}</p> : null}
      </section>
    );
  }

  return (
    <section className="login-card" aria-label="auth login required">
      <h2>Login required</h2>
      <p>Sign in with ChatGPT to start a conversation in minico.</p>
      {statusMessage ? <p aria-live="polite">{statusMessage}</p> : null}
      <label htmlFor="loginCodexHome">CODEX_HOME</label>
      <div className="codex-home-input-row">
        <input
          id="loginCodexHome"
          type="text"
          value={codexHomeInput}
          onChange={(event) => onCodexHomeInputChange(event.currentTarget.value)}
          onBlur={onCodexHomeBlur}
          placeholder="~/.minico/codex"
        />
        <button
          type="button"
          className="icon-button icon-button-muted codex-home-action"
          onClick={onPickCodexHomeFolder}
          disabled={actionDisabled}
          aria-label="Browse CODEX_HOME folder"
          title="Browse CODEX_HOME folder"
        >
          <FolderOpen size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button icon-button-muted codex-home-action"
          onClick={onResetCodexHomeDefault}
          disabled={actionDisabled}
          aria-label="Use default CODEX_HOME"
          title="Use default CODEX_HOME"
        >
          <RotateCcw size={16} aria-hidden="true" />
        </button>
      </div>
      <button type="button" onClick={onStartLogin} disabled={actionDisabled}>
        {busy ? "Starting..." : "Continue with ChatGPT"}
      </button>
      {auth.message ? <p className="form-warning">{auth.message}</p> : null}
    </section>
  );
}
