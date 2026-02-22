import { initialSessionState } from "../../core/session/store";
import { SettingsView } from "../settings/SettingsView";

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">minico</h1>
        <p className="app-subtitle">V0 bootstrap workspace is ready.</p>
      </header>
      <main className="app-main">
        <section className="status-card" aria-label="bootstrap status">
          <h2>Session status</h2>
          <p>
            Stage: <strong>{initialSessionState.stage}</strong>
          </p>
          <p>
            Target: <strong>{initialSessionState.buildTarget}</strong>
          </p>
        </section>
        <SettingsView />
      </main>
    </div>
  );
}
