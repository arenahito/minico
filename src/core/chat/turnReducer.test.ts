import { describe, expect, it } from "vitest";
import {
  eventToTurnAction,
  initialTurnStreamState,
  orderedTurnItems,
  reduceTurnStream,
} from "./turnReducer";

describe("turnReducer", () => {
  it("maps notification events into reducer actions", () => {
    const action = eventToTurnAction({
      kind: "notification",
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1" },
      },
    });
    expect(action).toEqual({
      type: "turnStarted",
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });

  it("ignores malformed notification payloads", () => {
    const action = eventToTurnAction({
      kind: "notification",
      method: "turn/started",
      params: {
        threadId: 123,
        turn: { id: null },
      },
    });
    expect(action).toBeNull();
  });

  it("maps reasoning delta notification into assistant update action", () => {
    const action = eventToTurnAction({
      kind: "notification",
      method: "item/reasoning/delta",
      params: {
        itemId: "item-reasoning-1",
        delta: "候補を比較中",
      },
    });

    expect(action).toEqual({
      type: "assistantDelta",
      channel: "reasoning",
      text: "候補を比較中",
      mode: "replace",
    });
  });

  it("ignores agent item started notification to avoid duplicate bubble", () => {
    const action = eventToTurnAction({
      kind: "notification",
      method: "item/started",
      params: {
        item: {
          id: "item-agent-1",
          type: "agentMessage",
        },
      },
    });

    expect(action).toBeNull();
  });

  it("applies streaming delta flow in order", () => {
    const turnStarted = reduceTurnStream(initialTurnStreamState, {
      type: "turnStarted",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const withDelta = reduceTurnStream(turnStarted, {
      type: "assistantDelta",
      channel: "agentMessage",
      text: "hello",
      mode: "append",
    });
    const completed = reduceTurnStream(withDelta, {
      type: "turnCompleted",
      threadId: "thread-1",
      turnId: "turn-1",
    });

    const items = orderedTurnItems(completed);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("hello");
    expect(items[0].role).toBe("agent");
    expect(typeof items[0].createdAt).toBe("number");
    expect(items[0].completed).toBe(true);
  });

  it("overwrites reasoning text with first agent output and then appends deltas", () => {
    const turnStarted = reduceTurnStream(initialTurnStreamState, {
      type: "turnStarted",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const withReasoning = reduceTurnStream(turnStarted, {
      type: "assistantDelta",
      channel: "reasoning",
      text: "候補を比較中",
      mode: "replace",
    });
    const withFirstAgentDelta = reduceTurnStream(withReasoning, {
      type: "assistantDelta",
      channel: "agentMessage",
      text: "回答です",
      mode: "append",
    });
    const withSecondAgentDelta = reduceTurnStream(withFirstAgentDelta, {
      type: "assistantDelta",
      channel: "agentMessage",
      text: "。",
      mode: "append",
    });

    const items = orderedTurnItems(withSecondAgentDelta);
    expect(items).toHaveLength(1);
    expect(items[0].itemType).toBe("agentMessage");
    expect(items[0].text).toBe("回答です。");
    expect(items[0].completed).toBe(false);
  });

  it("adds submitted user prompt as completed user item", () => {
    const next = reduceTurnStream(initialTurnStreamState, {
      type: "userPromptSubmitted",
      threadId: "thread-1",
      itemId: "local-user-1",
      text: "please summarize this",
    });

    const items = orderedTurnItems(next);
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe("user");
    expect(items[0].text).toBe("please summarize this");
    expect(typeof items[0].createdAt).toBe("number");
    expect(items[0].completed).toBe(true);
  });

  it("clears active turn when completion arrives", () => {
    const active = reduceTurnStream(initialTurnStreamState, {
      type: "turnStarted",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const next = reduceTurnStream(active, {
      type: "turnCompleted",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    expect(next.activeTurnId).toBeNull();
    expect(next.completedTurnIds).toContain("turn-1");
  });

  it("hydrates thread history on resume", () => {
    const next = reduceTurnStream(initialTurnStreamState, {
      type: "hydrateThreadHistory",
      threadId: "thread-9",
      items: [
        {
          id: "u1",
          itemType: "userMessage",
          role: "user",
          text: "hello",
          completed: true,
        },
        {
          id: "a1",
          itemType: "agentMessage",
          role: "agent",
          text: "world",
          completed: true,
        },
      ],
    });

    expect(next.activeThreadId).toBe("thread-9");
    expect(next.activeTurnId).toBeNull();
    const items = orderedTurnItems(next);
    expect(items).toHaveLength(2);
    expect(items[0].text).toBe("hello");
    expect(items[1].text).toBe("world");
    expect(items[0].completed).toBe(true);
    expect(items[1].completed).toBe(true);
  });
});
