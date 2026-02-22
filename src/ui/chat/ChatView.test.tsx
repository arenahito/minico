import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { TurnStreamItem, TurnStreamState } from "../../core/chat/turnReducer";

function turnState(activeTurnId: string | null): TurnStreamState {
  return {
    activeThreadId: "thread-1",
    activeTurnId,
    orderedItemIds: [],
    itemsById: {},
    completedTurnIds: [],
  };
}

function item(overrides: Partial<TurnStreamItem>): TurnStreamItem {
  return {
    id: "item-1",
    itemType: "agentMessage",
    role: "agent",
    createdAt: Date.now(),
    text: "hello",
    completed: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("ChatView", () => {
  it("shows minico thinking indicator while a turn is active", () => {
    render(
      <ChatView
        turnState={turnState("turn-1")}
        items={[]}
        workspacePath="C:/workspace/demo"
        composerValue=""
        selectorLabel="Select model"
        selectorDisplay="gpt-5 / medium"
        selectorOptions={[{ value: "gpt-5", label: "gpt-5" }]}
        selectorValue="gpt-5"
        busy={false}
        onComposerChange={vi.fn()}
        onSelectorChange={vi.fn(() => true)}
        onCreateThread={vi.fn()}
        onSubmitPrompt={vi.fn()}
        onInterrupt={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("minico thinking indicator")).toBeVisible();
    expect(screen.getByText("minico is thinking...")).toBeVisible();
    expect(screen.queryByText("No streamed items yet. Send a prompt to begin.")).toBeNull();
  });

  it("hides thinking indicator when there is no active turn", () => {
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        workspacePath="C:/workspace/demo"
        composerValue=""
        selectorLabel="Select model"
        selectorDisplay="gpt-5 / medium"
        selectorOptions={[{ value: "gpt-5", label: "gpt-5" }]}
        selectorValue="gpt-5"
        busy={false}
        onComposerChange={vi.fn()}
        onSelectorChange={vi.fn(() => true)}
        onCreateThread={vi.fn()}
        onSubmitPrompt={vi.fn()}
        onInterrupt={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("minico thinking indicator")).toBeNull();
    expect(screen.getByText("No streamed items yet. Send a prompt to begin.")).toBeVisible();
  });

  it("keeps existing message bubbles while showing thinking indicator", () => {
    render(
      <ChatView
        turnState={turnState("turn-2")}
        items={[item({ text: "existing response" })]}
        workspacePath="C:/workspace/demo"
        composerValue=""
        selectorLabel="Select model"
        selectorDisplay="gpt-5 / medium"
        selectorOptions={[{ value: "gpt-5", label: "gpt-5" }]}
        selectorValue="gpt-5"
        busy={false}
        onComposerChange={vi.fn()}
        onSelectorChange={vi.fn(() => true)}
        onCreateThread={vi.fn()}
        onSubmitPrompt={vi.fn()}
        onInterrupt={vi.fn()}
      />,
    );

    expect(screen.getByText("existing response")).toBeVisible();
    expect(screen.getByLabelText("minico thinking indicator")).toBeVisible();
  });

  it("submits prompt with ctrl+enter", () => {
    const onSubmitPrompt = vi.fn();
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        workspacePath="C:/workspace/demo"
        composerValue="hello"
        selectorLabel="Select model"
        selectorDisplay="gpt-5 / medium"
        selectorOptions={[{ value: "gpt-5", label: "gpt-5" }]}
        selectorValue="gpt-5"
        busy={false}
        onComposerChange={vi.fn()}
        onSelectorChange={vi.fn(() => true)}
        onCreateThread={vi.fn()}
        onSubmitPrompt={onSubmitPrompt}
        onInterrupt={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true });
    expect(onSubmitPrompt).toHaveBeenCalledTimes(1);
  });

  it("does not submit prompt with ctrl+enter when input is empty", () => {
    const onSubmitPrompt = vi.fn();
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        workspacePath="C:/workspace/demo"
        composerValue="   "
        selectorLabel="Select model"
        selectorDisplay="gpt-5 / medium"
        selectorOptions={[{ value: "gpt-5", label: "gpt-5" }]}
        selectorValue="gpt-5"
        busy={false}
        onComposerChange={vi.fn()}
        onSelectorChange={vi.fn(() => true)}
        onCreateThread={vi.fn()}
        onSubmitPrompt={onSubmitPrompt}
        onInterrupt={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true });
    expect(onSubmitPrompt).not.toHaveBeenCalled();
  });
});
