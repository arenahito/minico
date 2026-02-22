import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { TurnStreamItem, TurnStreamState } from "../../core/chat/turnReducer";
import { ChevronDown, ListPlus, Paperclip, Send, Square } from "lucide-react";

export interface ComposerSelectOption {
  value: string;
  label: string;
}

interface ChatViewProps {
  turnState: TurnStreamState;
  items: TurnStreamItem[];
  workspacePath: string | null;
  composerValue: string;
  selectorLabel: string;
  selectorDisplay: string;
  selectorOptions: ComposerSelectOption[];
  selectorValue: string;
  busy: boolean;
  onComposerChange: (nextValue: string) => void;
  onSelectorChange: (nextValue: string) => boolean;
  onCreateThread: () => void;
  onSubmitPrompt: () => void;
  onInterrupt: () => void;
}

export function ChatView({
  turnState,
  items,
  workspacePath,
  composerValue,
  selectorLabel,
  selectorDisplay,
  selectorOptions,
  selectorValue,
  busy,
  onComposerChange,
  onSelectorChange,
  onCreateThread,
  onSubmitPrompt,
  onInterrupt,
}: ChatViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectorRootRef = useRef<HTMLDivElement | null>(null);
  const [fileHint, setFileHint] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const showAgentTypingIndicator = Boolean(turnState.activeTurnId);
  const canSubmit = !busy && composerValue.trim().length > 0;
  const visibleItems = items.filter((item) => {
    const text = item.text.trim();
    if (item.role === "user" && text.length === 0) {
      return false;
    }
    if (item.completed && text.length === 0) {
      return false;
    }
    return true;
  });

  function handlePickFile(): void {
    fileInputRef.current?.click();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = event.currentTarget.files;
    if (!files || files.length === 0) {
      setFileHint(null);
      return;
    }
    if (files.length === 1) {
      setFileHint(files[0].name);
      return;
    }
    setFileHint(`${files.length} files selected`);
  }

  useEffect(() => {
    function handleOutsidePointer(event: MouseEvent): void {
      if (!selectorRootRef.current) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!selectorRootRef.current.contains(target)) {
        setSelectorOpen(false);
      }
    }

    window.addEventListener("mousedown", handleOutsidePointer);
    return () => {
      window.removeEventListener("mousedown", handleOutsidePointer);
    };
  }, []);

  return (
    <section className="chat-view" aria-label="chat view">
      <header className="chat-view-header">
        <p className="chat-workspace-path" title={workspacePath ?? ""}>
          <code>{workspacePath ?? "(resolving workspace path...)"}</code>
        </p>
      </header>

      <div className="chat-stream" aria-live="polite">
        {visibleItems.map((item) => (
          <article
            key={item.id}
            className={`chat-item ${
              item.role === "user" ? "chat-item-user" : "chat-item-agent"
            }`}
          >
            <p className="chat-item-body">{item.text || "..."}</p>
            {!item.completed ? (
              <footer className="chat-item-meta">
                <span className="chat-item-state">minico is thinking...</span>
              </footer>
            ) : null}
          </article>
        ))}
        {showAgentTypingIndicator ? (
          <article
            className="chat-item chat-item-agent chat-item-typing"
            aria-label="minico thinking indicator"
          >
            <div className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="typing-label">minico is thinking...</p>
          </article>
        ) : null}
        {visibleItems.length === 0 && !showAgentTypingIndicator ? (
          <p className="chat-empty">No streamed items yet. Send a prompt to begin.</p>
        ) : null}
      </div>

      <div className="composer">
        <textarea
          id="promptInput"
          value={composerValue}
          onChange={(event) => onComposerChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !event.ctrlKey) {
              return;
            }
            if (!canSubmit) {
              return;
            }
            event.preventDefault();
            onSubmitPrompt();
          }}
          placeholder="Type a prompt for Codex..."
          rows={4}
        />
        <div className="composer-toolbar">
          <div className="composer-left-controls">
            <input
              ref={fileInputRef}
              className="composer-file-input"
              type="file"
              multiple
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="icon-button icon-button-muted"
              onClick={handlePickFile}
              aria-label="Add file"
              title={fileHint ? `Add file (${fileHint})` : "Add file"}
            >
              <Paperclip size={16} aria-hidden="true" />
            </button>
            <div className="model-select" ref={selectorRootRef}>
              <button
                type="button"
                className="model-select-trigger"
                aria-label={selectorLabel}
                aria-haspopup="listbox"
                aria-expanded={selectorOpen}
                onClick={() => setSelectorOpen((current) => !current)}
              >
                <span className="model-select-value">{selectorDisplay}</span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              {selectorOpen ? (
                <ul className="model-select-menu" role="listbox" aria-label={selectorLabel}>
                  {selectorOptions.map((option) => (
                    <li key={option.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectorValue === option.value}
                        className="model-select-option"
                        onClick={() => {
                          const shouldClose = onSelectorChange(option.value);
                          if (shouldClose) {
                            setSelectorOpen(false);
                          }
                        }}
                      >
                        {option.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <button
              type="button"
              className="icon-button icon-button-muted"
              onClick={onCreateThread}
              aria-label="Create new thread"
              title="New thread"
            >
              <ListPlus size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="composer-actions">
          <button
            type="button"
            className="icon-button icon-button-muted"
            onClick={onInterrupt}
            disabled={!turnState.activeTurnId || busy}
            aria-label="Interrupt turn"
            title="Interrupt turn"
          >
            <Square size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button icon-button-primary"
            onClick={onSubmitPrompt}
            disabled={!canSubmit}
            aria-label={busy ? "Sending prompt" : "Send prompt"}
            title={busy ? "Sending..." : "Send"}
          >
            <Send size={18} aria-hidden="true" />
          </button>
          </div>
        </div>
      </div>
    </section>
  );
}
