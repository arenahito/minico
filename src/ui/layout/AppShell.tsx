import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

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
  listThreads,
  pollSessionEvents,
  resumeThread,
  startThread,
  startTurn,
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
  initializeWindowPlacementLifecycle,
  persistWindowPlacement,
} from "../../core/window/windowStateClient";
import { ApprovalDialog } from "../approval/ApprovalDialog";
import { ChatView } from "../chat/ChatView";
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

export function AppShell() {
  const [auth, setAuth] = useState<AuthMachineState>(initialAuthMachineState);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [turnState, dispatchTurn] = useReducer(
    reduceTurnStream,
    initialTurnStreamState,
  );
  const [approvalState, setApprovalState] =
    useState<ApprovalState>(initialApprovalState);
  const [showSettings, setShowSettings] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [authRefreshKey, setAuthRefreshKey] = useState(0);
  const [authStatusChecking, setAuthStatusChecking] = useState(false);
  const authRefreshInFlightRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const autoCancelInFlightRef = useRef<Set<number>>(new Set());

  const activeApproval = useMemo(
    () => currentApproval(approvalState),
    [approvalState],
  );
  const turnItems = useMemo(() => orderedTurnItems(turnState), [turnState]);

  useEffect(() => {
    void initializeWindowPlacementLifecycle();
    const handleBeforeUnload = () => {
      void persistWindowPlacement();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      void persistWindowPlacement();
    };
  }, []);

  useEffect(() => {
    if (authRefreshInFlightRef.current) {
      return;
    }

    let cancelled = false;
    authRefreshInFlightRef.current = true;
    setAuthStatusChecking(true);
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
        }
        authRefreshInFlightRef.current = false;
      });

    return () => {
      cancelled = true;
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
      return;
    }

    let cancelled = false;
    void listThreads()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setThreads(loaded);
        if (!activeThreadId && loaded.length > 0) {
          setActiveThreadId(loaded[0].id);
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
  }, [auth.view, activeThreadId]);

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
    setBusy(true);
    try {
      const started = await startThread();
      setActiveThreadId(started.threadId);
      dispatchTurn({ type: "resetThread", threadId: started.threadId });
      await refreshThreads();
    } catch (reason) {
      setError(mapErrorToUserFacing(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectThread(threadId: string): Promise<void> {
    setBusy(true);
    try {
      const resumed = await resumeThread(threadId);
      setActiveThreadId(resumed.threadId);
      dispatchTurn({ type: "resetThread", threadId: resumed.threadId });
    } catch (reason) {
      setError(mapErrorToUserFacing(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitPrompt(): Promise<void> {
    const trimmed = composerValue.trim();
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
        dispatchTurn({ type: "resetThread", threadId: started.threadId });
      }

      const turn = await startTurn(targetThreadId, trimmed);
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

  return (
    <div className="app-shell">
      {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

      {auth.view === "loggedIn" ? (
        <main className="app-main">
          <ThreadListPanel
            threads={threads}
            activeThreadId={activeThreadId}
            busy={busy}
            onCreateThread={() => void handleCreateThread()}
            onRefreshThreads={() => void refreshThreads()}
            onSelectThread={(threadId) => void handleSelectThread(threadId)}
            onOpenSettings={() => setShowSettings((current) => !current)}
          />

          <section className="main-content">
            {showSettings ? (
              <SettingsView />
            ) : (
              <ChatView
                turnState={turnState}
                items={turnItems}
                composerValue={composerValue}
                busy={busy}
                onComposerChange={setComposerValue}
                onSubmitPrompt={() => void handleSubmitPrompt()}
                onInterrupt={() => void handleInterruptTurn()}
              />
            )}
          </section>
        </main>
      ) : (
        <main className="auth-main">
          <LoginView
            auth={auth}
            busy={busy}
            statusChecking={authStatusChecking}
            onStartLogin={() => void handleStartLogin()}
            onLogoutAndContinue={() => void handleLogoutAndContinue()}
            onRetryStatus={handleRetryStatusCheck}
          />
        </main>
      )}

      <ApprovalDialog
        request={activeApproval}
        busy={approvalBusy}
        onDecision={(decision) => void handleApprovalDecision(decision)}
      />
    </div>
  );
}
