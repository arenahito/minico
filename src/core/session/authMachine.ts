import { invoke } from "@tauri-apps/api/core";

export type BackendAuthState =
  | "loggedIn"
  | "loginRequired"
  | "unsupportedApiKey";

export interface BackendAuthStatus {
  state: BackendAuthState;
  accountEmail: string | null;
  requiresOpenaiAuth: boolean;
  rawAuthMode: string | null;
  message: string | null;
}

export interface AuthLoginStartResult {
  authUrl: string;
  loginId: string | null;
}

export type AuthViewState =
  | "checking"
  | "loginRequired"
  | "loginInProgress"
  | "loggedIn"
  | "unsupportedApiKey"
  | "error";

export interface AuthMachineState {
  view: AuthViewState;
  accountEmail: string | null;
  message: string | null;
  rawAuthMode: string | null;
  lastLoginId: string | null;
}

export type AuthMachineEvent =
  | { type: "bootstrapRequested" }
  | { type: "statusLoaded"; status: BackendAuthStatus }
  | { type: "loginStarted"; loginId: string | null }
  | { type: "loginCompletedNotification"; success: boolean; error: string | null }
  | { type: "accountUpdatedNotification"; authMode: string | null }
  | { type: "failed"; message: string };

export const initialAuthMachineState: AuthMachineState = {
  view: "checking",
  accountEmail: null,
  message: null,
  rawAuthMode: null,
  lastLoginId: null,
};

function mapBackendState(status: BackendAuthStatus): AuthMachineState {
  const nextView: AuthViewState =
    status.state === "loggedIn"
      ? "loggedIn"
      : status.state === "unsupportedApiKey"
        ? "unsupportedApiKey"
        : "loginRequired";

  return {
    view: nextView,
    accountEmail: status.accountEmail,
    message: status.message,
    rawAuthMode: status.rawAuthMode,
    lastLoginId: null,
  };
}

export function reduceAuthMachine(
  state: AuthMachineState,
  event: AuthMachineEvent,
): AuthMachineState {
  switch (event.type) {
    case "bootstrapRequested":
      return {
        ...state,
        view: "checking",
        message: null,
      };
    case "statusLoaded":
      return mapBackendState(event.status);
    case "loginStarted":
      return {
        ...state,
        view: "loginInProgress",
        message: null,
        lastLoginId: event.loginId,
      };
    case "loginCompletedNotification":
      if (event.success) {
        return {
          ...state,
          view: "checking",
          message: null,
        };
      }
      return {
        ...state,
        view: "loginRequired",
        message: event.error ?? "Login was cancelled or failed.",
      };
    case "accountUpdatedNotification":
      if (event.authMode === "chatgpt") {
        return {
          ...state,
          view: "loggedIn",
          message: null,
          rawAuthMode: event.authMode,
        };
      }
      if (event.authMode === "apikey") {
        return {
          ...state,
          view: "unsupportedApiKey",
          rawAuthMode: event.authMode,
          message:
            "API-key authentication is not supported. Logout and continue with ChatGPT login.",
        };
      }
      return {
        ...state,
        view: "loginRequired",
        rawAuthMode: event.authMode,
      };
    case "failed":
      return {
        ...state,
        view: "error",
        message: event.message,
      };
    default:
      return state;
  }
}

export async function readAuthStatus(): Promise<BackendAuthStatus> {
  return invoke<BackendAuthStatus>("auth_read_status");
}

export async function startChatgptLogin(): Promise<AuthLoginStartResult> {
  return invoke<AuthLoginStartResult>("auth_login_start_chatgpt");
}

export async function logoutAndReadAuth(): Promise<BackendAuthStatus> {
  return invoke<BackendAuthStatus>("auth_logout_and_read");
}

