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

afterEach(() => {
  cleanup();
});

describe("LoginView", () => {
  it("renders login required branch", () => {
    render(
      <LoginView
        auth={state("loginRequired")}
        busy={false}
        statusChecking={false}
        startupChecking={false}
        startupCheckSlow={false}
        onStartLogin={vi.fn()}
        onLogoutAndContinue={vi.fn()}
        onRetryStatus={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Login required" })).toBeVisible();
  });

  it("renders unsupported branch", () => {
    render(
      <LoginView
        auth={state("unsupportedApiKey")}
        busy={false}
        statusChecking={false}
        startupChecking={false}
        startupCheckSlow={false}
        onStartLogin={vi.fn()}
        onLogoutAndContinue={vi.fn()}
        onRetryStatus={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "API key mode is not supported" }),
    ).toBeVisible();
  });

  it("shows retry action during login-in-progress", () => {
    render(
      <LoginView
        auth={state("loginInProgress")}
        busy={false}
        statusChecking={false}
        startupChecking={false}
        startupCheckSlow={false}
        onStartLogin={vi.fn()}
        onLogoutAndContinue={vi.fn()}
        onRetryStatus={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Retry status check" })).toBeVisible();
  });

  it("shows status check message and disables auth actions while checking", () => {
    render(
      <LoginView
        auth={state("loginRequired")}
        busy={false}
        statusChecking
        startupChecking={false}
        startupCheckSlow={false}
        onStartLogin={vi.fn()}
        onLogoutAndContinue={vi.fn()}
        onRetryStatus={vi.fn()}
      />,
    );
    expect(screen.getByText("Checking account status in the background...")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Checking..." })).toBeDisabled();
  });

  it("renders startup preparation state before login-required state", () => {
    render(
      <LoginView
        auth={state("loginRequired")}
        busy={false}
        statusChecking
        startupChecking
        startupCheckSlow={false}
        onStartLogin={vi.fn()}
        onLogoutAndContinue={vi.fn()}
        onRetryStatus={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Preparing minico" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Preparing minico" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue with ChatGPT" })).toBeNull();
  });
});
