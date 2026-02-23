import type { SessionPolledEvent } from "./threadService";

export interface TurnStreamItem {
  id: string;
  itemType: string;
  role: "agent" | "user";
  createdAt: number;
  text: string;
  completed: boolean;
}

export interface TurnStreamState {
  activeThreadId: string | null;
  activeTurnId: string | null;
  activeAssistantItemId: string | null;
  orderedItemIds: string[];
  itemsById: Record<string, TurnStreamItem>;
  completedTurnIds: string[];
}

type AssistantStreamChannel = "agentMessage" | "reasoning" | "plan";
type AssistantStreamMode = "append" | "replace";

export type TurnAction =
  | { type: "turnStarted"; threadId: string; turnId: string }
  | { type: "itemStarted"; itemId: string; itemType: string }
  | {
      type: "assistantDelta";
      channel: AssistantStreamChannel;
      text: string;
      mode: AssistantStreamMode;
    }
  | { type: "userPromptSubmitted"; threadId: string; itemId: string; text: string }
  | {
      type: "hydrateThreadHistory";
      threadId: string;
      items: Array<
        Pick<TurnStreamItem, "id" | "itemType" | "role" | "text" | "completed">
      >;
    }
  | { type: "itemCompleted"; itemId: string }
  | { type: "turnCompleted"; threadId: string; turnId: string }
  | { type: "turnInterrupted"; turnId: string }
  | { type: "resetThread"; threadId: string };

export const initialTurnStreamState: TurnStreamState = {
  activeThreadId: null,
  activeTurnId: null,
  activeAssistantItemId: null,
  orderedItemIds: [],
  itemsById: {},
  completedTurnIds: [],
};

function inferRoleFromItemType(itemType: string): "agent" | "user" {
  if (itemType.toLowerCase().includes("user")) {
    return "user";
  }
  return "agent";
}

function ensureItem(
  state: TurnStreamState,
  itemId: string,
  itemType: string,
): TurnStreamState {
  if (state.itemsById[itemId]) {
    return state;
  }

  return {
    ...state,
    orderedItemIds: [...state.orderedItemIds, itemId],
    itemsById: {
      ...state.itemsById,
      [itemId]: {
        id: itemId,
        itemType,
        role: inferRoleFromItemType(itemType),
        createdAt: Date.now(),
        text: "",
        completed: false,
      },
    },
  };
}

function ensureActiveAssistantItem(state: TurnStreamState): {
  state: TurnStreamState;
  itemId: string;
} | null {
  if (!state.activeTurnId) {
    return null;
  }
  const existingItemId = state.activeAssistantItemId;
  if (existingItemId && state.itemsById[existingItemId]) {
    return { state, itemId: existingItemId };
  }

  const itemId = existingItemId ?? `assistant-live-${state.activeTurnId}`;
  const withItem = ensureItem(state, itemId, "reasoning");
  if (withItem.activeAssistantItemId === itemId) {
    return { state: withItem, itemId };
  }
  return {
    state: {
      ...withItem,
      activeAssistantItemId: itemId,
    },
    itemId,
  };
}

function finalizeActiveAssistant(
  state: TurnStreamState,
  keepCompleted: boolean,
): TurnStreamState {
  if (!state.activeAssistantItemId) {
    return state;
  }
  const assistantItem = state.itemsById[state.activeAssistantItemId];
  if (!assistantItem) {
    return {
      ...state,
      activeAssistantItemId: null,
    };
  }
  return {
    ...state,
    activeAssistantItemId: null,
    itemsById: {
      ...state.itemsById,
      [assistantItem.id]: {
        ...assistantItem,
        completed: keepCompleted,
      },
    },
  };
}

function extractAssistantText(params: Record<string, unknown>): string | null {
  if (typeof params.delta === "string") {
    return params.delta;
  }
  if (
    params.delta &&
    typeof params.delta === "object" &&
    typeof (params.delta as Record<string, unknown>).text === "string"
  ) {
    return (params.delta as Record<string, unknown>).text as string;
  }
  if (typeof params.text === "string") {
    return params.text;
  }
  const summary = params.summary;
  if (Array.isArray(summary)) {
    const lines = summary.filter((entry): entry is string => typeof entry === "string");
    if (lines.length > 0) {
      return lines.join("\n");
    }
  }
  const item = params.item as Record<string, unknown> | undefined;
  if (!item) {
    return null;
  }
  if (typeof item.text === "string") {
    return item.text;
  }
  const itemSummary = item.summary;
  if (Array.isArray(itemSummary)) {
    const lines = itemSummary
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as Record<string, unknown>).text === "string"
        ) {
          return (entry as Record<string, unknown>).text as string;
        }
        return null;
      })
      .filter((entry): entry is string => typeof entry === "string");
    if (lines.length > 0) {
      return lines.join("\n");
    }
  }
  return null;
}

function assistantMetaFromMethod(
  method: string,
): { channel: AssistantStreamChannel; mode: AssistantStreamMode } | null {
  if (method === "item/agentMessage/delta") {
    return { channel: "agentMessage", mode: "append" };
  }

  const match = method.match(/^item\/([^/]+)\/delta$/);
  if (!match) {
    return null;
  }

  const channel = match[1]?.toLowerCase() ?? "";
  if (channel.includes("agentmessage")) {
    return { channel: "agentMessage", mode: "append" };
  }
  if (channel.includes("reasoning")) {
    return { channel: "reasoning", mode: "replace" };
  }
  if (channel.includes("plan")) {
    return { channel: "plan", mode: "replace" };
  }
  return null;
}

export function reduceTurnStream(
  state: TurnStreamState,
  action: TurnAction,
): TurnStreamState {
  switch (action.type) {
    case "resetThread":
      return {
        ...initialTurnStreamState,
        activeThreadId: action.threadId,
      };
    case "turnStarted":
      return {
        ...finalizeActiveAssistant(state, true),
        activeThreadId: action.threadId,
        activeTurnId: action.turnId,
        activeAssistantItemId: null,
      };
    case "hydrateThreadHistory": {
      const itemsById: TurnStreamState["itemsById"] = {};
      const orderedItemIds: string[] = [];
      const now = Date.now();
      action.items.forEach((item, index) => {
        if (itemsById[item.id]) {
          return;
        }
        orderedItemIds.push(item.id);
        itemsById[item.id] = {
          ...item,
          createdAt: now + index,
        };
      });
      return {
        activeThreadId: action.threadId,
        activeTurnId: null,
        activeAssistantItemId: null,
        orderedItemIds,
        itemsById,
        completedTurnIds: [],
      };
    }
    case "itemStarted":
      return ensureItem(state, action.itemId, action.itemType);
    case "assistantDelta": {
      const ensured = ensureActiveAssistantItem(state);
      if (!ensured) {
        return state;
      }
      const current = ensured.state.itemsById[ensured.itemId];
      const nextText =
        action.mode === "append" &&
        action.channel === "agentMessage" &&
        current.itemType === "agentMessage"
          ? `${current.text}${action.text}`
          : action.text;
      return {
        ...ensured.state,
        itemsById: {
          ...ensured.state.itemsById,
          [ensured.itemId]: {
            ...current,
            itemType: action.channel,
            text: nextText,
          },
        },
      };
    }
    case "userPromptSubmitted":
      if (state.itemsById[action.itemId]) {
        return state;
      }
      return {
        ...state,
        activeThreadId: action.threadId,
        orderedItemIds: [...state.orderedItemIds, action.itemId],
        itemsById: {
          ...state.itemsById,
          [action.itemId]: {
            id: action.itemId,
            itemType: "userMessage",
            role: "user",
            createdAt: Date.now(),
            text: action.text,
            completed: true,
          },
        },
      };
    case "itemCompleted": {
      const existing = state.itemsById[action.itemId];
      if (!existing) {
        return state;
      }
      return {
        ...state,
        itemsById: {
          ...state.itemsById,
          [action.itemId]: {
            ...existing,
            completed: true,
          },
        },
      };
    }
    case "turnCompleted":
      return finalizeActiveAssistant(
        {
          ...state,
          activeThreadId: action.threadId,
          activeTurnId:
            state.activeTurnId === action.turnId ? null : state.activeTurnId,
          completedTurnIds: state.completedTurnIds.includes(action.turnId)
            ? state.completedTurnIds
            : [...state.completedTurnIds, action.turnId],
        },
        true,
      );
    case "turnInterrupted":
      return finalizeActiveAssistant(
        {
          ...state,
          activeTurnId:
            state.activeTurnId === action.turnId ? null : state.activeTurnId,
        },
        true,
      );
    default:
      return state;
  }
}

export function eventToTurnAction(
  event: SessionPolledEvent,
): TurnAction | null {
  if (event.kind !== "notification") {
    return null;
  }

  const params = event.params;
  if (event.method === "turn/started") {
    const threadId = params.threadId;
    const turnId = (params.turn as { id?: unknown } | undefined)?.id;
    if (typeof threadId !== "string" || typeof turnId !== "string") {
      return null;
    }
    return { type: "turnStarted", threadId, turnId };
  }

  if (event.method === "item/started") {
    const item = params.item as { id?: unknown; type?: unknown } | undefined;
    if (!item || typeof item.id !== "string") {
      return null;
    }
    const itemType = typeof item.type === "string" ? item.type : "unknown";
    const itemTypeLower = itemType.toLowerCase();
    if (
      itemTypeLower.includes("agentmessage") ||
      itemTypeLower.includes("reasoning") ||
      itemTypeLower.includes("plan")
    ) {
      const assistantText = extractAssistantText(params);
      if (
        assistantText !== null &&
        (itemTypeLower.includes("reasoning") || itemTypeLower.includes("plan"))
      ) {
        return {
          type: "assistantDelta",
          channel: itemTypeLower.includes("plan") ? "plan" : "reasoning",
          text: assistantText,
          mode: "replace",
        };
      }
      return null;
    }
    return {
      type: "itemStarted",
      itemId: item.id,
      itemType,
    };
  }

  const assistantMeta = assistantMetaFromMethod(event.method);
  if (assistantMeta) {
    const text = extractAssistantText(params);
    if (typeof text !== "string" || text.length === 0) {
      return null;
    }
    return {
      type: "assistantDelta",
      channel: assistantMeta.channel,
      text,
      mode: assistantMeta.mode,
    };
  }

  if (event.method === "item/updated") {
    const item = params.item as { type?: unknown } | undefined;
    const itemType = typeof item?.type === "string" ? item.type.toLowerCase() : "";
    if (
      !itemType.includes("reasoning") &&
      !itemType.includes("plan") &&
      !itemType.includes("agentmessage")
    ) {
      return null;
    }
    const text = extractAssistantText(params);
    if (typeof text !== "string" || text.length === 0) {
      return null;
    }
    return {
      type: "assistantDelta",
      channel: itemType.includes("plan")
        ? "plan"
        : itemType.includes("reasoning")
          ? "reasoning"
          : "agentMessage",
      text,
      mode: "replace",
    };
  }

  if (event.method === "item/completed") {
    const item = params.item as { id?: unknown } | undefined;
    if (!item || typeof item.id !== "string") {
      return null;
    }
    return { type: "itemCompleted", itemId: item.id };
  }

  if (event.method === "turn/completed") {
    const threadId = params.threadId;
    const turnId = (params.turn as { id?: string } | undefined)?.id;
    if (typeof threadId !== "string" || typeof turnId !== "string") {
      return null;
    }
    return { type: "turnCompleted", threadId, turnId };
  }

  return null;
}

export function orderedTurnItems(state: TurnStreamState): TurnStreamItem[] {
  return state.orderedItemIds
    .map((itemId) => state.itemsById[itemId])
    .filter((item): item is TurnStreamItem => Boolean(item));
}
