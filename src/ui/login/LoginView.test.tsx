import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("LoginView", () => {
  it("renders login required branch", () => {
    render(
      <LoginView
        auth={state("loginRequired")}
        busy={false}
        onStartLogin={vi.fn()}
        onLogoutAndContinue={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Login required" })).toBeVisible();
  });

  it("renders unsupported branch", () => {
    render(
      <LoginView
        auth={state("unsupportedApiKey")}
        busy={false}
        onStartLogin={vi.fn()}
        onLogoutAndContinue={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "API key mode is not supported" }),
    ).toBeVisible();
  });
});

