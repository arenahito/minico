import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginView } from "./LoginView";
import type { AuthMachineState } from "../../core/session/authMachine";

function state(view: AuthMachineState["view"]): AuthMachineState {
  return {
    view,
    accountEmail: null,
    message: null,
    rawAuthMode: null,
    lastLoginId: null,
  };
}

function commonProps() {
  return {
    busy: false,
    statusChecking: false,
    startupChecking: false,
    startupCheckSlow: false,
    codexHomeInput: "C:/Users/test/.minico/codex",
    onCodexHomeInputChange: vi.fn(),
    onCodexHomeBlur: vi.fn(),
    onPickCodexHomeFolder: vi.fn(),
    onResetCodexHomeDefault: vi.fn(),
    onStartLogin: vi.fn(),
    onLogoutAndContinue: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
});

describe("LoginView", () => {
  it("renders login required branch", () => {
    const props = commonProps();
    render(
      <LoginView
        auth={state("loginRequired")}
        {...props}
      />,
    );
    expect(screen.getByRole("heading", { name: "Login required" })).toBeVisible();
    expect(screen.getByLabelText("CODEX_HOME")).toBeVisible();
    expect(screen.getByRole("button", { name: "Browse CODEX_HOME folder" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Use default CODEX_HOME" })).toBeVisible();
  });

  it("renders unsupported branch", () => {
    const props = commonProps();
    render(
      <LoginView
        auth={state("unsupportedApiKey")}
        {...props}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "API key mode is not supported" }),
    ).toBeVisible();
  });

  it("shows login-in-progress branch without retry button", () => {
    const props = commonProps();
    render(
      <LoginView
        auth={state("loginInProgress")}
        {...props}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Complete login in browser" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry status check" })).toBeNull();
  });

  it("shows status check message and disables auth actions while checking", () => {
    const props = commonProps();
    render(
      <LoginView
        auth={state("loginRequired")}
        {...props}
        statusChecking
      />,
    );
    expect(screen.getByText("Checking account status in the background...")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Checking..." })).toBeNull();
  });

  it("renders startup preparation state before login-required state", () => {
    const props = commonProps();
    render(
      <LoginView
        auth={state("loginRequired")}
        {...props}
        statusChecking={true}
        startupChecking
      />,
    );
    expect(screen.getByRole("heading", { name: "Preparing minico" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Preparing minico" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue with ChatGPT" })).toBeNull();
  });
});
