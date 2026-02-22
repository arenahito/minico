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

  it("applies streaming delta flow in order", () => {
    const turnStarted = reduceTurnStream(initialTurnStreamState, {
      type: "turnStarted",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const itemStarted = reduceTurnStream(turnStarted, {
      type: "itemStarted",
      itemId: "item-1",
      itemType: "agentMessage",
    });
    const withDelta = reduceTurnStream(itemStarted, {
      type: "agentMessageDelta",
      itemId: "item-1",
      delta: "hello",
    });
    const completed = reduceTurnStream(withDelta, {
      type: "itemCompleted",
      itemId: "item-1",
    });

    const items = orderedTurnItems(completed);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("hello");
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
});
