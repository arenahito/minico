import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { TurnStreamItem, TurnStreamState } from "../../core/chat/turnReducer";

const openMock = vi.fn();
const convertFileSrcMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (...args: unknown[]) => convertFileSrcMock(...args),
}));

function turnState(activeTurnId: string | null): TurnStreamState {
  return {
    activeThreadId: "thread-1",
    activeTurnId,
    activeAssistantItemId: null,
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

function buildDroppedFile(path: string): File {
  const fileName = path.split(/[\\/]/).pop() ?? "dropped.txt";
  const file = new File(["dropped"], fileName, { type: "application/octet-stream" }) as File & {
    path?: string;
  };
  file.path = path;
  return file;
}

function buildDropDataTransfer(paths: string[]): DataTransfer {
  const files = paths.map(buildDroppedFile);
  return {
    files,
    items: [],
    types: ["Files"],
    dropEffect: "none",
    getData: () => "",
  } as unknown as DataTransfer;
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  openMock.mockReset();
  convertFileSrcMock.mockReset();
  convertFileSrcMock.mockImplementation(
    (filePath: string) => `asset://localhost/${encodeURIComponent(filePath)}`,
  );
});

describe("ChatView", () => {
  it("shows minico thinking indicator while a turn is active", () => {
    render(
      <ChatView
        turnState={turnState("turn-1")}
        items={[]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
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
        threadLoading={false}
        threadCwd="C:/workspace/demo"
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

  it("shows loading status while selected thread is loading", () => {
    render(
      <ChatView
        turnState={turnState(null)}
        items={[item({ text: "stale response" })]}
        threadLoading
        threadCwd="C:/workspace/demo"
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

    expect(screen.getByText("Loading selected thread...")).toBeVisible();
    expect(screen.queryByText("stale response")).toBeNull();
  });

  it("keeps existing message bubbles while showing thinking indicator", () => {
    render(
      <ChatView
        turnState={turnState("turn-2")}
        items={[item({ text: "existing response" })]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
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

  it("does not render duplicate thinking bubble while agent item is in progress", () => {
    render(
      <ChatView
        turnState={turnState("turn-3")}
        items={[item({ completed: false, text: "" })]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
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
    expect(screen.getAllByText("minico is thinking...")).toHaveLength(1);
  });

  it("renders agent response as markdown", () => {
    render(
      <ChatView
        turnState={turnState(null)}
        items={[
          item({
            text: "**bold**\n\n- first item\n- second item\n\n[OpenAI](https://openai.com)",
          }),
        ]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
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

    const link = screen.getByRole("link", { name: "OpenAI" });
    expect(link).toHaveAttribute("href", "https://openai.com");
    expect(screen.getByText("bold", { selector: "strong" })).toBeVisible();
    expect(screen.getByText("first item")).toBeVisible();
    expect(screen.getByText("second item")).toBeVisible();
  });

  it("submits prompt with ctrl+enter", () => {
    const onSubmitPrompt = vi.fn();
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
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
    expect(onSubmitPrompt).toHaveBeenCalledWith("hello");
  });

  it("does not submit prompt with ctrl+enter when input is empty", () => {
    const onSubmitPrompt = vi.fn();
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
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

  it("shows selected thread path with current thread cwd and emits folder selection", async () => {
    openMock.mockResolvedValueOnce("D:\\work\\override");
    const onSelectThreadPath = vi.fn();
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
        selectedThreadPath="D:/work/override"
        composerValue=""
        selectorLabel="Select model"
        selectorDisplay="gpt-5 / medium"
        selectorOptions={[{ value: "gpt-5", label: "gpt-5" }]}
        selectorValue="gpt-5"
        busy={false}
        onComposerChange={vi.fn()}
        onSelectorChange={vi.fn(() => true)}
        onCreateThread={vi.fn()}
        onSelectThreadPath={onSelectThreadPath}
        onSubmitPrompt={vi.fn()}
        onInterrupt={vi.fn()}
      />,
    );

    expect(screen.getByText("D:/work/override (C:/workspace/demo)")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Select thread cwd" }));
    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      defaultPath: "D:/work/override",
    });
    await waitFor(() => {
      expect(onSelectThreadPath).toHaveBeenCalledWith("D:\\work\\override");
    });
  });

  it("uses thread cwd as default folder when selected thread path is not set", () => {
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
        composerValue=""
        selectorLabel="Select model"
        selectorDisplay="gpt-5 / medium"
        selectorOptions={[{ value: "gpt-5", label: "gpt-5" }]}
        selectorValue="gpt-5"
        busy={false}
        onComposerChange={vi.fn()}
        onSelectorChange={vi.fn(() => true)}
        onCreateThread={vi.fn()}
        onSelectThreadPath={vi.fn()}
        onSubmitPrompt={vi.fn()}
        onInterrupt={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select thread cwd" }));
    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      defaultPath: "C:/workspace/demo",
    });
  });

  it("renders inline path block for non-image attachment and allows removing it", async () => {
    openMock.mockResolvedValueOnce(["C:\\work\\readme.md"]);
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
        composerValue="note"
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

    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    await waitFor(() => {
      expect(screen.getByText("C:\\work\\readme.md")).toBeVisible();
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove readme.md" }));
    expect(screen.queryByText("C:\\work\\readme.md")).toBeNull();
  });

  it("renders image preview for image attachment and allows removing it", async () => {
    openMock.mockResolvedValueOnce(["C:\\work\\cat.png"]);
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
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

    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "cat.png" })).toBeVisible();
    });
    expect(convertFileSrcMock).toHaveBeenCalledWith("C:/work/cat.png");
    fireEvent.click(screen.getByRole("button", { name: "Remove cat.png" }));
    expect(screen.queryByRole("img", { name: "cat.png" })).toBeNull();
  });

  it("submits prompt with full-path attachment tokens prepended", async () => {
    openMock.mockResolvedValueOnce(["C:\\work\\readme.md"]);
    const onSubmitPrompt = vi.fn();
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
        composerValue="test prompt"
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

    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    await waitFor(() => {
      expect(screen.getByText("C:\\work\\readme.md")).toBeVisible();
    });
    fireEvent.click(screen.getByRole("button", { name: "Send prompt" }));

    expect(onSubmitPrompt).toHaveBeenCalledWith(
      "[@readme.md](file:///C:/work/readme.md) test prompt",
    );
  });

  it("renders attachment tokens in user message as attachment UI instead of raw text", () => {
    render(
      <ChatView
        turnState={turnState(null)}
        items={[
          item({
            role: "user",
            itemType: "userMessage",
            text: "[@cat.png](file:///C:/work/cat.png) [@readme.md](file:///C:/work/readme.md) この画像の説明",
          }),
        ]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
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

    expect(screen.getByRole("img", { name: "cat.png" })).toBeVisible();
    expect(screen.getByText("C:\\work\\readme.md")).toBeVisible();
    expect(screen.getByText("この画像の説明")).toBeVisible();
    expect(screen.queryByText(/\[@cat\.png\]/)).toBeNull();
    expect(screen.queryByText(/\(file:\/\/\/C:\/work\/cat\.png\)/)).toBeNull();
  });

  it("attaches dropped files on the chat pane", async () => {
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
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

    const chatPane = screen.getByLabelText("chat view");
    fireEvent.drop(chatPane, {
      dataTransfer: buildDropDataTransfer(["C:\\work\\dropped.md"]),
    });

    await waitFor(() => {
      expect(screen.getByText("C:\\work\\dropped.md")).toBeVisible();
    });
  });

  it("submits dropped file attachment token with prompt", async () => {
    const onSubmitPrompt = vi.fn();
    render(
      <ChatView
        turnState={turnState(null)}
        items={[]}
        threadLoading={false}
        threadCwd="C:/workspace/demo"
        composerValue="drop test"
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

    const chatPane = screen.getByLabelText("chat view");
    fireEvent.drop(chatPane, {
      dataTransfer: buildDropDataTransfer(["C:\\work\\dropped.md"]),
    });

    await waitFor(() => {
      expect(screen.getByText("C:\\work\\dropped.md")).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: "Send prompt" }));
    expect(onSubmitPrompt).toHaveBeenCalledWith(
      "[@dropped.md](file:///C:/work/dropped.md) drop test",
    );
  });
});
