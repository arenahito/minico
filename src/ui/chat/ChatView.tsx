import type { TurnStreamItem, TurnStreamState } from "../../core/chat/turnReducer";

interface ChatViewProps {
  turnState: TurnStreamState;
  items: TurnStreamItem[];
  composerValue: string;
  busy: boolean;
  onComposerChange: (nextValue: string) => void;
  onSubmitPrompt: () => void;
  onInterrupt: () => void;
}

export function ChatView({
  turnState,
  items,
  composerValue,
  busy,
  onComposerChange,
  onSubmitPrompt,
  onInterrupt,
}: ChatViewProps) {
  return (
    <section className="chat-view" aria-label="chat view">
      <header className="chat-view-header">
        <h2>Conversation</h2>
        <div className="chat-status">
          <p>
            Active thread:{" "}
            <strong>{turnState.activeThreadId ?? "(select or create)"}</strong>
          </p>
          <p>
            Active turn: <strong>{turnState.activeTurnId ?? "none"}</strong>
          </p>
        </div>
      </header>

      <div className="chat-stream" aria-live="polite">
        {items.map((item) => (
          <article key={item.id} className="chat-item">
            <header>
              <code>{item.itemType}</code>
              <span>{item.completed ? "completed" : "streaming"}</span>
            </header>
            <pre>{item.text || "(no text delta yet)"}</pre>
          </article>
        ))}
        {items.length === 0 ? (
          <p className="chat-empty">No streamed items yet. Send a prompt to begin.</p>
        ) : null}
      </div>

      <div className="composer">
        <label htmlFor="promptInput">Prompt</label>
        <textarea
          id="promptInput"
          value={composerValue}
          onChange={(event) => onComposerChange(event.currentTarget.value)}
          placeholder="Type a prompt for Codex..."
          rows={4}
        />
        <div className="composer-actions">
          <button
            type="button"
            onClick={onSubmitPrompt}
            disabled={busy || composerValue.trim().length === 0}
          >
            {busy ? "Sending..." : "Send"}
          </button>
          <button
            type="button"
            onClick={onInterrupt}
            disabled={!turnState.activeTurnId || busy}
          >
            Interrupt turn
          </button>
        </div>
      </div>
    </section>
  );
}

