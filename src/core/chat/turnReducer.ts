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
  orderedItemIds: string[];
  itemsById: Record<string, TurnStreamItem>;
  completedTurnIds: string[];
}

export type TurnAction =
  | { type: "turnStarted"; threadId: string; turnId: string }
  | { type: "itemStarted"; itemId: string; itemType: string }
  | { type: "agentMessageDelta"; itemId: string; delta: string }
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
        ...state,
        activeThreadId: action.threadId,
        activeTurnId: action.turnId,
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
        orderedItemIds,
        itemsById,
        completedTurnIds: [],
      };
    }
    case "itemStarted":
      return ensureItem(state, action.itemId, action.itemType);
    case "agentMessageDelta": {
      const withItem = ensureItem(state, action.itemId, "agentMessage");
      const current = withItem.itemsById[action.itemId];
      return {
        ...withItem,
        itemsById: {
          ...withItem.itemsById,
          [action.itemId]: {
            ...current,
            text: `${current.text}${action.delta}`,
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
      return {
        ...state,
        activeThreadId: action.threadId,
        activeTurnId:
          state.activeTurnId === action.turnId ? null : state.activeTurnId,
        completedTurnIds: state.completedTurnIds.includes(action.turnId)
          ? state.completedTurnIds
          : [...state.completedTurnIds, action.turnId],
      };
    case "turnInterrupted":
      return {
        ...state,
        activeTurnId:
          state.activeTurnId === action.turnId ? null : state.activeTurnId,
      };
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
    return {
      type: "itemStarted",
      itemId: item.id,
      itemType: typeof item.type === "string" ? item.type : "unknown",
    };
  }

  if (event.method === "item/agentMessage/delta") {
    const itemId = params.itemId;
    const delta = params.delta;
    if (typeof itemId !== "string" || typeof delta !== "string") {
      return null;
    }
    return {
      type: "agentMessageDelta",
      itemId,
      delta,
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
