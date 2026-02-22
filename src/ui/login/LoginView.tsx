import type { AuthMachineState } from "../../core/session/authMachine";

interface LoginViewProps {
  auth: AuthMachineState;
  busy: boolean;
  statusChecking: boolean;
  onStartLogin: () => void;
  onLogoutAndContinue: () => void;
  onRetryStatus: () => void;
}

export function LoginView({
  auth,
  busy,
  statusChecking,
  onStartLogin,
  onLogoutAndContinue,
  onRetryStatus,
}: LoginViewProps) {
  const actionDisabled = busy || statusChecking;
  const statusMessage = statusChecking
    ? "Checking account status in the background..."
    : null;

  if (auth.view === "checking") {
    return (
      <section className="login-card" aria-label="auth checking">
        <h2>Login required</h2>
        <p>Account state sync is running in the background.</p>
        {statusMessage ? <p aria-live="polite">{statusMessage}</p> : null}
        <div className="settings-actions">
          <button type="button" onClick={onStartLogin} disabled={actionDisabled}>
            {busy ? "Starting..." : "Continue with ChatGPT"}
          </button>
          <button type="button" onClick={onRetryStatus} disabled={actionDisabled}>
            {statusChecking ? "Checking..." : "Retry status check"}
          </button>
        </div>
      </section>
    );
  }

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
        <button type="button" onClick={onRetryStatus} disabled={actionDisabled}>
          {statusChecking ? "Checking..." : "Retry status check"}
        </button>
      </section>
    );
  }

  return (
    <section className="login-card" aria-label="auth login required">
      <h2>Login required</h2>
      <p>Sign in with ChatGPT to start a conversation in minico.</p>
      {statusMessage ? <p aria-live="polite">{statusMessage}</p> : null}
      <button type="button" onClick={onStartLogin} disabled={actionDisabled}>
        {busy ? "Starting..." : "Continue with ChatGPT"}
      </button>
      <button type="button" onClick={onRetryStatus} disabled={actionDisabled}>
        {statusChecking ? "Checking..." : "Retry status check"}
      </button>
      {auth.message ? <p className="form-warning">{auth.message}</p> : null}
    </section>
  );
}
