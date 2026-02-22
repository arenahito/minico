import type {
  ApprovalDecision,
  PendingApprovalRequest,
} from "../../core/approval/approvalStore";
import { FileChangePreview } from "./FileChangePreview";

interface ApprovalDialogProps {
  request: PendingApprovalRequest | null;
  busy: boolean;
  onDecision: (decision: ApprovalDecision) => void;
}

function readCommandContext(params: Record<string, unknown>): {
  command: string;
  cwd: string;
  reason: string | null;
} {
  const commandAction = params.command as
    | { command?: string[]; cwd?: string }
    | undefined;
  const command = Array.isArray(commandAction?.command)
    ? commandAction.command.join(" ")
    : "(unknown command)";
  return {
    command,
    cwd: commandAction?.cwd ?? String(params.cwd ?? "(unknown cwd)"),
    reason: (params.reason as string | null | undefined) ?? null,
  };
}

export function ApprovalDialog({ request, busy, onDecision }: ApprovalDialogProps) {
  if (!request) {
    return null;
  }

  const isCommand =
    request.method === "item/commandExecution/requestApproval";
  const command = isCommand ? readCommandContext(request.params) : null;

  return (
    <div className="approval-overlay" role="presentation">
      <section
        className="approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="approval request"
      >
        <header>
          <h2>
            {isCommand ? "Command approval required" : "File change approval required"}
          </h2>
          <p>
            Request ID: <code>{request.requestId}</code>
          </p>
        </header>

        {isCommand && command ? (
          <div className="approval-content">
            <p>
              <strong>Command:</strong> <code>{command.command}</code>
            </p>
            <p>
              <strong>CWD:</strong> <code>{command.cwd}</code>
            </p>
            {command.reason ? (
              <p>
                <strong>Reason:</strong> {command.reason}
              </p>
            ) : null}
          </div>
        ) : (
          <FileChangePreview params={request.params} />
        )}

        <footer className="approval-actions">
          <button type="button" onClick={() => onDecision("accept")} disabled={busy}>
            Accept
          </button>
          <button
            type="button"
            onClick={() => onDecision("acceptForSession")}
            disabled={busy}
          >
            Accept for session
          </button>
          <button type="button" onClick={() => onDecision("decline")} disabled={busy}>
            Decline
          </button>
          <button type="button" onClick={() => onDecision("cancel")} disabled={busy}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}

