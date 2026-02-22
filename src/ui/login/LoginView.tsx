import type { AuthMachineState } from "../../core/session/authMachine";

interface LoginViewProps {
  auth: AuthMachineState;
  busy: boolean;
  onStartLogin: () => void;
  onLogoutAndContinue: () => void;
}

export function LoginView({
  auth,
  busy,
  onStartLogin,
  onLogoutAndContinue,
}: LoginViewProps) {
  if (auth.view === "checking") {
    return (
      <section className="login-card" aria-label="auth checking">
        <h2>Checking account</h2>
        <p>Validating your Codex account state...</p>
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
        <button type="button" onClick={onLogoutAndContinue} disabled={busy}>
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
      </section>
    );
  }

  return (
    <section className="login-card" aria-label="auth login required">
      <h2>Login required</h2>
      <p>Sign in with ChatGPT to start a conversation in minico.</p>
      <button type="button" onClick={onStartLogin} disabled={busy}>
        {busy ? "Starting..." : "Continue with ChatGPT"}
      </button>
      {auth.message ? <p className="form-warning">{auth.message}</p> : null}
    </section>
  );
}

