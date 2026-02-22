import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalDialog } from "./ApprovalDialog";

afterEach(() => {
  cleanup();
});

describe("ApprovalDialog", () => {
  it("renders command approval context", () => {
    render(
      <ApprovalDialog
        request={{
          requestId: 1,
          method: "item/commandExecution/requestApproval",
          params: {
            command: { command: ["git", "status"], cwd: "C:/repo" },
            reason: "Need repository state",
          },
          receivedAt: Date.now(),
        }}
        busy={false}
        onDecision={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "approval request" })).toBeVisible();
    expect(screen.getByText("Command approval required")).toBeVisible();
    expect(screen.getByText("git status")).toBeVisible();
    expect(screen.getByText("Need repository state")).toBeVisible();
  });

  it("renders file change preview and sends all decisions", async () => {
    const onDecision = vi.fn();
    const user = userEvent.setup();

    render(
      <ApprovalDialog
        request={{
          requestId: 2,
          method: "item/fileChange/requestApproval",
          params: {
            changes: [{ path: "src/main.ts", diff: "+console.log('hi')" }],
          },
          receivedAt: Date.now(),
        }}
        busy={false}
        onDecision={onDecision}
      />,
    );

    expect(screen.getByText("File change approval required")).toBeVisible();
    expect(screen.getByLabelText("file change preview")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Accept" }));
    await user.click(screen.getByRole("button", { name: "Accept for session" }));
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDecision).toHaveBeenNthCalledWith(1, "accept");
    expect(onDecision).toHaveBeenNthCalledWith(2, "acceptForSession");
    expect(onDecision).toHaveBeenNthCalledWith(3, "decline");
    expect(onDecision).toHaveBeenNthCalledWith(4, "cancel");
  });
});
