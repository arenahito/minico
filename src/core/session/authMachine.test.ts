import { describe, expect, it } from "vitest";
import {
  initialAuthMachineState,
  reduceAuthMachine,
  type BackendAuthStatus,
} from "./authMachine";

describe("authMachine", () => {
  it("maps logged-in backend status", () => {
    const status: BackendAuthStatus = {
      state: "loggedIn",
      accountEmail: "demo@example.com",
      requiresOpenaiAuth: false,
      rawAuthMode: "chatgpt",
      message: null,
    };

    const next = reduceAuthMachine(initialAuthMachineState, {
      type: "statusLoaded",
      status,
    });
    expect(next.view).toBe("loggedIn");
    expect(next.accountEmail).toBe("demo@example.com");
  });

  it("maps unsupported api-key mode", () => {
    const status: BackendAuthStatus = {
      state: "unsupportedApiKey",
      accountEmail: null,
      requiresOpenaiAuth: false,
      rawAuthMode: "apikey",
      message: "API key mode is not supported",
    };

    const next = reduceAuthMachine(initialAuthMachineState, {
      type: "statusLoaded",
      status,
    });
    expect(next.view).toBe("unsupportedApiKey");
    expect(next.message).toContain("supported");
  });

  it("handles login completion notification failure", () => {
    const inProgress = reduceAuthMachine(initialAuthMachineState, {
      type: "loginStarted",
      loginId: "login-1",
    });
    const next = reduceAuthMachine(inProgress, {
      type: "loginCompletedNotification",
      success: false,
      error: "cancelled",
    });
    expect(next.view).toBe("loginRequired");
    expect(next.message).toBe("cancelled");
  });

  it("keeps current view on login completion success", () => {
    const inProgress = reduceAuthMachine(initialAuthMachineState, {
      type: "loginStarted",
      loginId: "login-1",
    });
    const next = reduceAuthMachine(inProgress, {
      type: "loginCompletedNotification",
      success: true,
      error: null,
    });
    expect(next.view).toBe("loginInProgress");
  });
});
