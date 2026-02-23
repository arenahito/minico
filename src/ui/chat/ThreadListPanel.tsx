import type { ThreadSummary } from "../../core/chat/threadService";
import { Archive, RefreshCw } from "lucide-react";

interface ThreadListPanelProps {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  busy: boolean;
  hasMoreThreads: boolean;
  loadingMoreThreads: boolean;
  collapsed: boolean;
  onRefreshThreads: () => void;
  onLoadMoreThreads: () => void;
  onSelectThread: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
}

export function ThreadListPanel({
  threads,
  activeThreadId,
  busy,
  hasMoreThreads,
  loadingMoreThreads,
  collapsed,
  onRefreshThreads,
  onLoadMoreThreads,
  onSelectThread,
  onArchiveThread,
}: ThreadListPanelProps) {
  return (
    <aside
      className={`thread-panel ${collapsed ? "is-collapsed" : ""}`}
      aria-label="thread list panel"
      aria-hidden={collapsed}
    >
      <div className="thread-panel-header">
        <h2>Threads</h2>
        <div className="thread-panel-actions">
          <button
            type="button"
            className="thread-panel-refresh-button"
            onClick={onRefreshThreads}
            disabled={busy}
            aria-label="Refresh threads"
            title="Refresh threads"
          >
            <RefreshCw size={15} aria-hidden="true" />
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
            <li key={thread.id} className="thread-list-row">
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
              <button
                type="button"
                className="thread-list-archive-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onArchiveThread(thread.id);
                }}
                disabled={busy}
                aria-label={`Archive thread ${title}`}
                title="Archive thread"
              >
                <Archive size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
        {threads.length === 0 ? <li className="thread-empty">No app-server threads yet.</li> : null}
        {hasMoreThreads ? (
          <li className="thread-load-more-row">
            <button
              type="button"
              className="thread-load-more-button"
              onClick={onLoadMoreThreads}
              disabled={busy || loadingMoreThreads}
              aria-label="Load more threads"
              title="Load more threads"
            >
              {loadingMoreThreads ? "Loading..." : "Load more"}
            </button>
          </li>
        ) : null}
      </ul>
    </aside>
  );
}
