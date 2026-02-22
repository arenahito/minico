import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { List, Settings, X } from "lucide-react";

import {
  cancelApprovalFallback,
  ingestApprovalEvent,
  respondApprovalDecision,
} from "../../core/approval/approvalBridge";
import {
  currentApproval,
  initialApprovalState,
  resolveApproval,
  type ApprovalDecision,
  type ApprovalState,
} from "../../core/approval/approvalStore";
import {
  interruptTurn,
  listModels,
  listThreads,
  pollSessionEvents,
  resumeThread,
  startThread,
  startTurn,
  type ModelSummary,
  type ReasoningEffort,
  type SessionPolledEvent,
  type ThreadSummary,
} from "../../core/chat/threadService";
import {
  eventToTurnAction,
  initialTurnStreamState,
  orderedTurnItems,
  reduceTurnStream,
  type TurnAction,
} from "../../core/chat/turnReducer";
import { mapErrorToUserFacing, type UserFacingError } from "../../core/errors/errorMapper";
import {
  initialAuthMachineState,
  logoutAndReadAuth,
  readAuthStatus,
  reduceAuthMachine,
  startChatgptLogin,
  type AuthMachineState,
} from "../../core/session/authMachine";
import {
  disposeWindowPlacementLifecycle,
  initializeWindowPlacementLifecycle,
  loadModelPreferenceRecord,
  loadThreadPanelOpenRecord,
  loadThreadPanelWidthRecord,
  persistModelPreferenceRecord,
  persistThreadPanelOpenRecord,
  persistThreadPanelWidthRecord,
} from "../../core/window/windowStateClient";
import { resolveActiveCwd } from "../../core/workspace/workspaceStore";
import { ApprovalDialog } from "../approval/ApprovalDialog";
import { ChatView, type ComposerSelectOption } from "../chat/ChatView";
import { ThreadListPanel } from "../chat/ThreadListPanel";
import { ErrorBanner } from "../common/ErrorBanner";
import { LoginView } from "../login/LoginView";
import { SettingsView } from "../settings/SettingsView";

function eventIsAccountSignal(event: SessionPolledEvent): boolean {
  return (
    event.kind === "notification" &&
    (event.method === "account/login/completed" || event.method === "account/updated")
  );
}

async function readAuthStatusWithTimeout(
  timeoutMs: number,
): ReturnType<typeof readAuthStatus> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(
        new Error(
          `Account status check timed out after ${timeoutMs}ms. Verify codex app-server responsiveness.`,
        ),
      );
    }, timeoutMs);

    void readAuthStatus()
      .then((status) => {
        window.clearTimeout(timer);
        resolve(status);
      })
      .catch((reason) => {
        window.clearTimeout(timer);
        reject(reason);
      });
  });
}

function dispatchAuthEventFromNotification(
  state: AuthMachineState,
  event: SessionPolledEvent,
): AuthMachineState {
  if (event.kind !== "notification") {
    return state;
  }

  if (event.method === "account/login/completed") {
    const success = Boolean(event.params.success);
    const error =
      typeof event.params.error === "string" ? event.params.error : null;
    return reduceAuthMachine(state, {
      type: "loginCompletedNotification",
      success,
      error,
    });
  }

  if (event.method === "account/updated") {
    const authMode =
      typeof event.params.authMode === "string" ? event.params.authMode : null;
    return reduceAuthMachine(state, {
      type: "accountUpdatedNotification",
      authMode,
    });
  }

  return state;
}

function applyTurnEvent(
  dispatch: Dispatch<TurnAction>,
  event: SessionPolledEvent,
): void {
  const action = eventToTurnAction(event);
  if (action) {
    dispatch(action);
  }
}

function shouldAutoRefreshAuth(view: AuthMachineState["view"]): boolean {
  return (
    view === "loginRequired" ||
    view === "loginInProgress" ||
    view === "unsupportedApiKey"
  );
}

type SelectorStage = "model" | "effort";

const MODEL_SELECTOR_BACK_VALUE = "__back_to_model__";
const EFFORT_SELECTOR_DEFAULT_VALUE = "__use_default_effort__";
const APP_TOOLBAR_WIDTH = 56;
const THREAD_PANEL_RESIZER_WIDTH = 8;
const THREAD_PANEL_MIN_WIDTH = 220;
const THREAD_PANEL_MAX_WIDTH = 560;
const CHAT_PANE_MIN_WIDTH = 420;
const DEFAULT_THREAD_PANEL_WIDTH = 320;
const REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

const FALLBACK_MODELS: ModelSummary[] = ["gpt-5", "gpt-5-mini", "o4-mini"].map(
  (model, index) => ({
    id: model,
    model,
    displayName: model,
    isDefault: index === 0,
    defaultReasoningEffort: null,
    supportedReasoningEfforts: [],
  }),
);

function normalizeReasoningEffort(value: string | null | undefined): ReasoningEffort | null {
  if (!value) {
    return null;
  }
  if (REASONING_EFFORTS.has(value as ReasoningEffort)) {
    return value as ReasoningEffort;
  }
  return null;
}

function resolveModelCatalog(models: ModelSummary[]): ModelSummary[] {
  const uniqueByModel = new Map<string, ModelSummary>();
  for (const model of models) {
    const name = model.model.trim();
    if (!name || uniqueByModel.has(name)) {
      continue;
    }
    uniqueByModel.set(name, {
      ...model,
      model: name,
      displayName: model.displayName?.trim() || name,
      defaultReasoningEffort: normalizeReasoningEffort(model.defaultReasoningEffort),
      supportedReasoningEfforts: model.supportedReasoningEfforts
        .map((effort) => normalizeReasoningEffort(effort))
        .filter((effort): effort is ReasoningEffort => effort !== null),
    });
  }
  if (uniqueByModel.size === 0) {
    return FALLBACK_MODELS;
  }
  return [...uniqueByModel.values()];
}

function resolveEffortForModel(model: ModelSummary | null): ReasoningEffort | null {
  if (!model) {
    return null;
  }
  if (model.defaultReasoningEffort) {
    return model.defaultReasoningEffort;
  }
  if (model.supportedReasoningEfforts.length > 0) {
    return model.supportedReasoningEfforts[0];
  }
  return null;
}

function modelOptionsFromCatalog(catalog: ModelSummary[]): ComposerSelectOption[] {
  return catalog.map((model) => ({
    value: model.model,
    label: model.displayName,
  }));
}

function resolveThreadPanelMaxWidth(containerWidth: number | null): number {
  if (containerWidth === null || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return THREAD_PANEL_MAX_WIDTH;
  }
  const layoutConstrainedMax =
    containerWidth - APP_TOOLBAR_WIDTH - THREAD_PANEL_RESIZER_WIDTH - CHAT_PANE_MIN_WIDTH;
  return Math.max(
    THREAD_PANEL_MIN_WIDTH,
    Math.min(THREAD_PANEL_MAX_WIDTH, layoutConstrainedMax),
  );
}

function clampThreadPanelWidth(width: number, containerWidth: number | null): number {
  const max = resolveThreadPanelMaxWidth(containerWidth);
  return Math.round(Math.min(max, Math.max(THREAD_PANEL_MIN_WIDTH, width)));
}

function modelPreferenceKey(model: string, effort: ReasoningEffort | null): string {
  return `${model}|${effort ?? "__default__"}`;
}

export function AppShell() {
  const [auth, setAuth] = useState<AuthMachineState>(initialAuthMachineState);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);
  const [turnState, dispatchTurn] = useReducer(
    reduceTurnStream,
    initialTurnStreamState,
  );
  const [approvalState, setApprovalState] =
    useState<ApprovalState>(initialApprovalState);
  const [showSettings, setShowSettings] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [modelCatalog, setModelCatalog] = useState<ModelSummary[]>(FALLBACK_MODELS);
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODELS[0].model);
  const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort | null>(null);
  const [selectorStage, setSelectorStage] = useState<SelectorStage>("model");
  const [threadPanelOpen, setThreadPanelOpen] = useState(true);
  const [threadPanelWidth, setThreadPanelWidth] = useState(DEFAULT_THREAD_PANEL_WIDTH);
  const [threadPanelResizing, setThreadPanelResizing] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [authRefreshKey, setAuthRefreshKey] = useState(0);
  const [authStatusChecking, setAuthStatusChecking] = useState(false);
  const [startupAuthCheckPending, setStartupAuthCheckPending] = useState(true);
  const [startupAuthCheckSlow, setStartupAuthCheckSlow] = useState(false);
  const startupAuthCheckPendingRef = useRef(true);
  const appMainRef = useRef<HTMLElement | null>(null);
  const authRefreshInFlightRef = useRef(false);
  const startupAuthSlowTimerRef = useRef<number | null>(null);
  const selectedModelRef = useRef(selectedModel);
  const threadPanelWidthRef = useRef(threadPanelWidth);
  const persistedThreadPanelOpenRef = useRef<boolean | null>(null);
  const persistedThreadPanelWidthRef = useRef<number | null>(null);
  const persistedModelPreferenceRef = useRef<string | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const pollInFlightRef = useRef(false);
  const autoCancelInFlightRef = useRef<Set<number>>(new Set());
  const localUserItemSeqRef = useRef(0);
  const selectThreadRequestSeqRef = useRef(0);

  const activeApproval = useMemo(
    () => currentApproval(approvalState),
    [approvalState],
  );
  const turnItems = useMemo(() => orderedTurnItems(turnState), [turnState]);
  const threadLoading =
    loadingThreadId !== null && activeThreadId === loadingThreadId;
  const appMainStyle = useMemo(
    () =>
      ({
        "--thread-panel-width": `${threadPanelWidth}px`,
      }) as CSSProperties,
    [threadPanelWidth],
  );
  const selectedModelSummary = useMemo(
    () => modelCatalog.find((model) => model.model === selectedModel) ?? null,
    [modelCatalog, selectedModel],
  );

  useEffect(() => {
    void initializeWindowPlacementLifecycle();
    return () => {
      disposeWindowPlacementLifecycle();
    };
  }, []);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    threadPanelWidthRef.current = threadPanelWidth;
  }, [threadPanelWidth]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (authRefreshInFlightRef.current) {
      return;
    }

    let cancelled = false;
    authRefreshInFlightRef.current = true;
    setAuthStatusChecking(true);
    if (startupAuthCheckPendingRef.current) {
      setStartupAuthCheckSlow(false);
      startupAuthSlowTimerRef.current = window.setTimeout(() => {
        setStartupAuthCheckSlow(true);
      }, 8000);
    }
    setAuth((current) => reduceAuthMachine(current, { type: "bootstrapRequested" }));
    void readAuthStatusWithTimeout(30000)
      .then((status) => {
        if (!cancelled) {
          setAuth((current) =>
            reduceAuthMachine(current, {
              type: "statusLoaded",
              status,
            }),
          );
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          const mapped = mapErrorToUserFacing(reason);
          setError(mapped);
          setAuth((current) =>
            reduceAuthMachine(current, {
              type: "failed",
              message: mapped.message,
            }),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthStatusChecking(false);
          if (startupAuthCheckPendingRef.current) {
            startupAuthCheckPendingRef.current = false;
            setStartupAuthCheckPending(false);
            setStartupAuthCheckSlow(false);
          }
        }
        if (startupAuthSlowTimerRef.current !== null) {
          window.clearTimeout(startupAuthSlowTimerRef.current);
          startupAuthSlowTimerRef.current = null;
        }
        authRefreshInFlightRef.current = false;
      });

    return () => {
      cancelled = true;
      if (startupAuthSlowTimerRef.current !== null) {
        window.clearTimeout(startupAuthSlowTimerRef.current);
        startupAuthSlowTimerRef.current = null;
      }
    };
  }, [authRefreshKey]);

  useEffect(() => {
    if (!shouldAutoRefreshAuth(auth.view)) {
      return;
    }

    const timer = window.setInterval(() => {
      if (!authRefreshInFlightRef.current) {
        setAuthRefreshKey((current) => current + 1);
      }
    }, 10000);

    return () => {
      window.clearInterval(timer);
    };
  }, [auth.view]);

  useEffect(() => {
    if (auth.view !== "loggedIn") {
      setShowSettings(false);
      setWorkspacePath(null);
      setThreadPanelOpen(true);
      setActiveThreadId(null);
      setLoadingThreadId(null);
      setThreads([]);
      return;
    }

    let cancelled = false;
    void listThreads()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setThreads(loaded);
        setActiveThreadId((current) =>
          current && loaded.some((thread) => thread.id === current) ? current : null,
        );
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(mapErrorToUserFacing(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [auth.view]);

  useEffect(() => {
    if (auth.view !== "loggedIn") {
      return;
    }

    let cancelled = false;
    void resolveActiveCwd()
      .then((resolved) => {
        if (!cancelled) {
          setWorkspacePath(resolved.cwd);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(mapErrorToUserFacing(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [auth.view]);

  useEffect(() => {
    if (auth.view !== "loggedIn") {
      persistedThreadPanelOpenRef.current = null;
      return;
    }

    let cancelled = false;
    void loadThreadPanelOpenRecord()
      .then((savedOpen) => {
        if (cancelled || savedOpen === null) {
          return;
        }
        persistedThreadPanelOpenRef.current = savedOpen;
        setThreadPanelOpen(savedOpen);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(mapErrorToUserFacing(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [auth.view]);

  useEffect(() => {
    if (auth.view !== "loggedIn") {
      setThreadPanelResizing(false);
      return;
    }

    let cancelled = false;
    void loadThreadPanelWidthRecord()
      .then((savedWidth) => {
        if (cancelled || savedWidth === null) {
          return;
        }
        const clamped = clampThreadPanelWidth(
          savedWidth,
          appMainRef.current?.clientWidth ?? null,
        );
        persistedThreadPanelWidthRef.current = clamped;
        setThreadPanelWidth(clamped);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(mapErrorToUserFacing(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [auth.view]);

  useEffect(() => {
    function handleResize(): void {
      setThreadPanelWidth((current) =>
        clampThreadPanelWidth(current, appMainRef.current?.clientWidth ?? null),
      );
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!showSettings) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setShowSettings(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showSettings]);

  useEffect(() => {
    if (auth.view !== "loggedIn") {
      setModelCatalog(FALLBACK_MODELS);
      setSelectedModel(FALLBACK_MODELS[0].model);
      setSelectedEffort(resolveEffortForModel(FALLBACK_MODELS[0]));
      setSelectorStage("model");
      persistedModelPreferenceRef.current = null;
      return;
    }

    let cancelled = false;
    async function bootstrapModelSelector(): Promise<void> {
      try {
        const [loaded, persistedPreference] = await Promise.all([
          listModels(),
          loadModelPreferenceRecord().catch((reason) => {
            if (!cancelled) {
              setError(mapErrorToUserFacing(reason));
            }
            return null;
          }),
        ]);
        if (cancelled) {
          return;
        }

        const catalog = resolveModelCatalog(loaded);
        setModelCatalog(catalog);
        const persistedModel = persistedPreference?.model ?? null;
        const defaultModel = catalog.find((model) => model.isDefault)?.model ?? null;
        const nextModel =
          (persistedModel && catalog.some((model) => model.model === persistedModel)
            ? persistedModel
            : null) ??
          (defaultModel && catalog.some((model) => model.model === defaultModel)
            ? defaultModel
            : null) ??
          (catalog.some((model) => model.model === selectedModelRef.current)
            ? selectedModelRef.current
            : catalog[0].model);
        const nextSummary = catalog.find((model) => model.model === nextModel) ?? null;
        const persistedEffort = normalizeReasoningEffort(persistedPreference?.effort);
        const supportedEfforts = new Set(nextSummary?.supportedReasoningEfforts ?? []);
        const nextEffort: ReasoningEffort | null =
          persistedModel === nextModel
            ? persistedEffort && supportedEfforts.has(persistedEffort)
              ? persistedEffort
              : persistedPreference?.effort === null
                ? null
                : resolveEffortForModel(nextSummary)
            : resolveEffortForModel(nextSummary);

        persistedModelPreferenceRef.current = modelPreferenceKey(nextModel, nextEffort);
        setSelectedModel(nextModel);
        setSelectedEffort(nextEffort);
        setSelectorStage("model");
      } catch {
        if (!cancelled) {
          const fallbackEffort = resolveEffortForModel(FALLBACK_MODELS[0]);
          persistedModelPreferenceRef.current = modelPreferenceKey(
            FALLBACK_MODELS[0].model,
            fallbackEffort,
          );
          setModelCatalog(FALLBACK_MODELS);
          setSelectedModel(FALLBACK_MODELS[0].model);
          setSelectedEffort(fallbackEffort);
          setSelectorStage("model");
        }
      }
    }

    void bootstrapModelSelector();

    return () => {
      cancelled = true;
    };
  }, [auth.view]);

  useEffect(() => {
    if (auth.view !== "loggedIn") {
      persistedModelPreferenceRef.current = null;
      return;
    }

    const nextKey = modelPreferenceKey(selectedModel, selectedEffort);
    if (persistedModelPreferenceRef.current === nextKey) {
      return;
    }
    persistedModelPreferenceRef.current = nextKey;
    void persistModelPreferenceRecord(selectedModel, selectedEffort).catch((reason) => {
      persistedModelPreferenceRef.current = null;
      setError(mapErrorToUserFacing(reason));
    });
  }, [auth.view, selectedEffort, selectedModel]);

  useEffect(() => {
    if (auth.view !== "loginInProgress" && auth.view !== "loggedIn") {
      return;
    }

    let cancelled = false;

    async function tick() {
      if (pollInFlightRef.current) {
        return;
      }

      pollInFlightRef.current = true;
      try {
        const events = await pollSessionEvents(150, 24);
        if (cancelled || events.length === 0) {
          pollInFlightRef.current = false;
          return;
        }

        for (const event of events) {
          if (event.kind === "malformedLine") {
            setError(
              mapErrorToUserFacing(
                `Invalid app-server message: ${event.reason || event.raw}`,
              ),
            );
            continue;
          }

          if (eventIsAccountSignal(event)) {
            setAuth((current) => dispatchAuthEventFromNotification(current, event));
            if (
              event.kind === "notification" &&
              event.method === "account/login/completed" &&
              event.params.success === true
            ) {
              setAuthRefreshKey((current) => current + 1);
            }
          }

          applyTurnEvent(dispatchTurn, event);

          if (event.kind === "serverRequest") {
            setApprovalState((current) => ingestApprovalEvent(current, event));
          }
        }
      } catch (reason) {
        if (!cancelled) {
          setError(mapErrorToUserFacing(reason));
        }
      } finally {
        pollInFlightRef.current = false;
      }
    }

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 350);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [auth.view]);

  useEffect(() => {
    if (!activeApproval || auth.view === "loggedIn") {
      return;
    }

    if (autoCancelInFlightRef.current.has(activeApproval.requestId)) {
      return;
    }

    autoCancelInFlightRef.current.add(activeApproval.requestId);
    void (async () => {
      let resolved = false;
      try {
        await cancelApprovalFallback(activeApproval.requestId);
        resolved = true;
      } catch (reason) {
        setError(mapErrorToUserFacing(reason));
      } finally {
        if (resolved) {
          setApprovalState((current) =>
            resolveApproval(current, activeApproval.requestId),
          );
        }
        autoCancelInFlightRef.current.delete(activeApproval.requestId);
      }
    })();
  }, [activeApproval, auth.view]);

  async function refreshThreads(): Promise<void> {
    setBusy(true);
    try {
      const loaded = await listThreads();
      setThreads(loaded);
    } catch (reason) {
      setError(mapErrorToUserFacing(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateThread(): Promise<void> {
    selectThreadRequestSeqRef.current += 1;
    setLoadingThreadId(null);
    setBusy(true);
    try {
      const started = await startThread();
      setActiveThreadId(started.threadId);
      setWorkspacePath(started.cwd);
      dispatchTurn({ type: "resetThread", threadId: started.threadId });
      await refreshThreads();
    } catch (reason) {
      setError(mapErrorToUserFacing(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectThread(threadId: string): Promise<void> {
    selectThreadRequestSeqRef.current += 1;
    const requestSeq = selectThreadRequestSeqRef.current;
    setActiveThreadId(threadId);
    setLoadingThreadId(threadId);
    dispatchTurn({ type: "resetThread", threadId });
    setBusy(true);
    try {
      const resumed = await resumeThread(threadId);
      if (requestSeq !== selectThreadRequestSeqRef.current) {
        return;
      }
      setActiveThreadId(resumed.threadId);
      setWorkspacePath(resumed.cwd);
      dispatchTurn({
        type: "hydrateThreadHistory",
        threadId: resumed.threadId,
        items: resumed.historyItems,
      });
    } catch (reason) {
      if (requestSeq !== selectThreadRequestSeqRef.current) {
        return;
      }
      setError(mapErrorToUserFacing(reason));
    } finally {
      if (requestSeq === selectThreadRequestSeqRef.current) {
        setLoadingThreadId(null);
        setBusy(false);
      }
    }
  }

  async function handleSubmitPrompt(composedPrompt?: string): Promise<void> {
    const basePrompt = typeof composedPrompt === "string" ? composedPrompt : composerValue;
    const trimmed = basePrompt.trim();
    if (!trimmed) {
      return;
    }

    setBusy(true);
    try {
      let targetThreadId = activeThreadId;
      if (!targetThreadId) {
        const started = await startThread();
        targetThreadId = started.threadId;
        setActiveThreadId(started.threadId);
        setWorkspacePath(started.cwd);
        dispatchTurn({ type: "resetThread", threadId: started.threadId });
      }

      localUserItemSeqRef.current += 1;
      dispatchTurn({
        type: "userPromptSubmitted",
        threadId: targetThreadId,
        itemId: `local-user-${localUserItemSeqRef.current}`,
        text: trimmed,
      });

      const turn = await startTurn(
        targetThreadId,
        trimmed,
        selectedModel,
        selectedEffort,
      );
      setWorkspacePath(turn.cwd);
      if (turn.turnId) {
        dispatchTurn({
          type: "turnStarted",
          threadId: targetThreadId,
          turnId: turn.turnId,
        });
      }
      setComposerValue("");
      await refreshThreads();
    } catch (reason) {
      setError(mapErrorToUserFacing(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleInterruptTurn(): Promise<void> {
    if (!activeThreadId || !turnState.activeTurnId) {
      return;
    }

    setBusy(true);
    try {
      await interruptTurn(activeThreadId, turnState.activeTurnId);
      dispatchTurn({
        type: "turnInterrupted",
        turnId: turnState.activeTurnId,
      });
    } catch (reason) {
      setError(mapErrorToUserFacing(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleStartLogin(): Promise<void> {
    setBusy(true);
    try {
      const login = await startChatgptLogin();
      setAuth((current) =>
        reduceAuthMachine(current, {
          type: "loginStarted",
          loginId: login.loginId,
        }),
      );
      await openUrl(login.authUrl);
    } catch (reason) {
      setError(mapErrorToUserFacing(reason));
      setAuth((current) =>
        reduceAuthMachine(current, {
          type: "failed",
          message: String(reason),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLogoutAndContinue(): Promise<void> {
    setBusy(true);
    try {
      const status = await logoutAndReadAuth();
      setAuth((current) =>
        reduceAuthMachine(current, {
          type: "statusLoaded",
          status,
        }),
      );
    } catch (reason) {
      setError(mapErrorToUserFacing(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleApprovalDecision(
    decision: ApprovalDecision,
  ): Promise<void> {
    const approval = activeApproval;
    if (!approval) {
      return;
    }

    setApprovalBusy(true);
    let resolved = false;
    try {
      await respondApprovalDecision(approval.requestId, decision);
      resolved = true;
    } catch (reason) {
      setError(mapErrorToUserFacing(reason));
      try {
        await cancelApprovalFallback(approval.requestId);
        resolved = true;
      } catch (fallbackError) {
        setError(mapErrorToUserFacing(fallbackError));
      }
    } finally {
      if (resolved) {
        setApprovalState((current) =>
          resolveApproval(current, approval.requestId),
        );
      }
      setApprovalBusy(false);
    }
  }

  function handleRetryStatusCheck(): void {
    if (authRefreshInFlightRef.current) {
      return;
    }
    setAuthRefreshKey((current) => current + 1);
  }

  function persistThreadPanelWidthIfChanged(width: number): void {
    if (persistedThreadPanelWidthRef.current === width) {
      return;
    }
    persistedThreadPanelWidthRef.current = width;
    void persistThreadPanelWidthRecord(width).catch((reason) => {
      setError(mapErrorToUserFacing(reason));
    });
  }

  function persistThreadPanelOpenIfChanged(open: boolean): void {
    if (persistedThreadPanelOpenRef.current === open) {
      return;
    }
    persistedThreadPanelOpenRef.current = open;
    void persistThreadPanelOpenRecord(open).catch((reason) => {
      setError(mapErrorToUserFacing(reason));
    });
  }

  function handleToggleThreadPanel(): void {
    if (auth.view !== "loggedIn") {
      return;
    }

    setThreadPanelOpen((current) => {
      const nextOpen = !current;
      if (!nextOpen) {
        dragCleanupRef.current?.();
        dragCleanupRef.current = null;
        setThreadPanelResizing(false);
        setShowSettings(false);
      }
      persistThreadPanelOpenIfChanged(nextOpen);
      return nextOpen;
    });
  }

  function handleThreadPanelResizeStart(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (
      event.button !== 0 ||
      auth.view !== "loggedIn" ||
      !threadPanelOpen
    ) {
      return;
    }

    dragCleanupRef.current?.();
    dragCleanupRef.current = null;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = threadPanelWidthRef.current;
    setThreadPanelResizing(true);

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientX - startX;
      const next = clampThreadPanelWidth(
        startWidth + delta,
        appMainRef.current?.clientWidth ?? null,
      );
      setThreadPanelWidth(next);
    };

    const finishResize = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      dragCleanupRef.current = null;
      setThreadPanelResizing(false);
      persistThreadPanelWidthIfChanged(threadPanelWidthRef.current);
    };

    dragCleanupRef.current = finishResize;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }

  const selectorLabel =
    selectorStage === "model"
      ? "Select model"
      : `Select reasoning effort for ${selectedModel}`;
  const selectorDisplay = useMemo(() => {
    const effectiveEffort =
      selectedEffort ??
      selectedModelSummary?.defaultReasoningEffort ??
      "default";
    return `${selectedModel} / ${effectiveEffort}`;
  }, [selectedEffort, selectedModel, selectedModelSummary]);
  const selectorOptions = useMemo<ComposerSelectOption[]>(() => {
    if (selectorStage === "model") {
      return modelOptionsFromCatalog(modelCatalog);
    }
    const effortValues = selectedModelSummary
      ? [...new Set(selectedModelSummary.supportedReasoningEfforts)]
      : [];
    const defaultLabel = selectedModelSummary?.defaultReasoningEffort
      ? `Default (${selectedModelSummary.defaultReasoningEffort})`
      : "Default (server)";
    const options: ComposerSelectOption[] = [
      { value: MODEL_SELECTOR_BACK_VALUE, label: "← Back to model selection" },
      { value: EFFORT_SELECTOR_DEFAULT_VALUE, label: defaultLabel },
    ];
    for (const effort of effortValues) {
      options.push({ value: effort, label: effort });
    }
    return options;
  }, [modelCatalog, selectedModelSummary, selectorStage]);
  const selectorValue = useMemo(() => {
    if (selectorStage === "model") {
      return selectedModel;
    }
    if (!selectedEffort) {
      return EFFORT_SELECTOR_DEFAULT_VALUE;
    }
    const effortValues = selectedModelSummary
      ? new Set(selectedModelSummary.supportedReasoningEfforts)
      : new Set<ReasoningEffort>();
    return effortValues.has(selectedEffort)
      ? selectedEffort
      : EFFORT_SELECTOR_DEFAULT_VALUE;
  }, [selectedEffort, selectedModel, selectedModelSummary, selectorStage]);

  function handleComposerSelectorChange(nextValue: string): boolean {
    if (selectorStage === "model") {
      const nextModel = modelCatalog.find((model) => model.model === nextValue) ?? null;
      if (!nextModel) {
        return false;
      }
      const modelChanged = nextModel.model !== selectedModel;
      setSelectedModel(nextModel.model);
      if (modelChanged) {
        setSelectedEffort(resolveEffortForModel(nextModel));
      }
      setSelectorStage("effort");
      return false;
    }

    if (nextValue === MODEL_SELECTOR_BACK_VALUE) {
      setSelectorStage("model");
      return false;
    }
    if (nextValue === EFFORT_SELECTOR_DEFAULT_VALUE) {
      setSelectedEffort(null);
      setSelectorStage("model");
      return true;
    }
    const effort = normalizeReasoningEffort(nextValue);
    if (effort) {
      setSelectedEffort(effort);
      setSelectorStage("model");
      return true;
    }
    return false;
  }

  return (
    <div className={`app-shell ${threadPanelResizing ? "is-resizing-thread-panel" : ""}`}>
      {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

      {auth.view === "loggedIn" ? (
        <main
          className={`app-main ${threadPanelOpen ? "" : "is-thread-panel-collapsed"}`}
          ref={appMainRef}
          style={appMainStyle}
        >
          <aside className="app-sidebar-toolbar" aria-label="navigation toolbar">
            <button
              type="button"
              className={`toolbar-button ${threadPanelOpen ? "is-active" : ""}`}
              aria-label="Toggle thread panel"
              title={threadPanelOpen ? "Hide threads" : "Show threads"}
              onClick={handleToggleThreadPanel}
            >
              <List size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`toolbar-button toolbar-button-settings ${showSettings ? "is-active" : ""}`}
              aria-label="Open settings"
              title="Settings"
              onClick={() => setShowSettings(true)}
            >
              <Settings size={17} aria-hidden="true" />
            </button>
          </aside>
          {threadPanelOpen ? (
            <>
              <ThreadListPanel
                threads={threads}
                activeThreadId={activeThreadId}
                busy={busy}
                onRefreshThreads={() => void refreshThreads()}
                onSelectThread={(threadId) => void handleSelectThread(threadId)}
              />
              <div
                className={`thread-panel-resizer ${threadPanelResizing ? "is-dragging" : ""}`}
                role="separator"
                aria-label="Resize thread panel"
                aria-orientation="vertical"
                onPointerDown={handleThreadPanelResizeStart}
              />
            </>
          ) : null}

          <section className="main-content">
            <ChatView
              turnState={turnState}
              items={turnItems}
              threadLoading={threadLoading}
              workspacePath={workspacePath}
              composerValue={composerValue}
              selectorLabel={selectorLabel}
              selectorDisplay={selectorDisplay}
              selectorOptions={selectorOptions}
              selectorValue={selectorValue}
              busy={busy}
              onComposerChange={setComposerValue}
              onSelectorChange={handleComposerSelectorChange}
              onCreateThread={() => void handleCreateThread()}
              onSubmitPrompt={(nextPrompt) => void handleSubmitPrompt(nextPrompt)}
              onInterrupt={() => void handleInterruptTurn()}
            />
          </section>
        </main>
      ) : (
        <main className="auth-main">
          <LoginView
            auth={auth}
            busy={busy}
            statusChecking={authStatusChecking}
            startupChecking={startupAuthCheckPending && authStatusChecking}
            startupCheckSlow={startupAuthCheckPending && startupAuthCheckSlow}
            onStartLogin={() => void handleStartLogin()}
            onLogoutAndContinue={() => void handleLogoutAndContinue()}
            onRetryStatus={handleRetryStatusCheck}
          />
        </main>
      )}

      {auth.view === "loggedIn" && showSettings ? (
        <div
          className="settings-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowSettings(false);
            }
          }}
        >
          <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
            <button
              type="button"
              className="settings-modal-close"
              onClick={() => setShowSettings(false)}
              aria-label="Close settings"
              title="Close"
            >
              <X size={17} aria-hidden="true" />
            </button>
            <div className="settings-modal-body">
              <SettingsView />
            </div>
          </section>
        </div>
      ) : null}

      <ApprovalDialog
        request={activeApproval}
        busy={approvalBusy}
        onDecision={(decision) => void handleApprovalDecision(decision)}
      />
    </div>
  );
}
