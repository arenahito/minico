import type { ThreadSummary } from "../../core/chat/threadService";

interface ThreadListPanelProps {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  busy: boolean;
  onRefreshThreads: () => void;
  onSelectThread: (threadId: string) => void;
  onOpenSettings: () => void;
}

export function ThreadListPanel({
  threads,
  activeThreadId,
  busy,
  onRefreshThreads,
  onSelectThread,
  onOpenSettings,
}: ThreadListPanelProps) {
  return (
    <aside className="thread-panel" aria-label="thread list panel">
      <div className="thread-panel-header">
        <h2>Threads</h2>
        <div className="thread-panel-actions">
          <button type="button" onClick={onRefreshThreads} disabled={busy}>
            Refresh
          </button>
          <button type="button" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      </div>
      <ul className="thread-list" role="listbox" aria-label="thread history">
        {threads.map((thread) => {
          const trimmedName = thread.name?.trim() ?? "";
          const trimmedPreview = thread.preview.trim();
          const title = trimmedName || trimmedPreview || "(No title yet)";
          const showSummary =
            trimmedName.length > 0 &&
            trimmedPreview.length > 0 &&
            trimmedPreview !== trimmedName;
          return (
            <li key={thread.id}>
              <button
                type="button"
                className={`thread-list-item ${
                  thread.id === activeThreadId ? "is-active" : ""
                }`}
                onClick={() => onSelectThread(thread.id)}
                aria-selected={thread.id === activeThreadId}
              >
                <span className="thread-title">{title}</span>
                {showSummary ? (
                  <span className="thread-summary">{trimmedPreview}</span>
                ) : null}
              </button>
            </li>
          );
        })}
        {threads.length === 0 ? <li className="thread-empty">No app-server threads yet.</li> : null}
      </ul>
    </aside>
  );
}
