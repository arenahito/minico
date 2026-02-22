import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const initializeWindowPlacementLifecycle = vi.fn().mockResolvedValue(undefined);
const persistWindowPlacement = vi.fn().mockResolvedValue(undefined);

vi.mock("../settings/SettingsView", () => ({
  SettingsView: () => <section aria-label="settings mock">settings</section>,
}));

vi.mock("../../core/window/windowStateClient", () => ({
  initializeWindowPlacementLifecycle: (...args: unknown[]) =>
    initializeWindowPlacementLifecycle(...args),
  persistWindowPlacement: (...args: unknown[]) => persistWindowPlacement(...args),
}));

describe("AppShell", () => {
  it("renders the bootstrap status screen", () => {
    const { unmount } = render(<AppShell />);
    expect(
      screen.getByRole("heading", { level: 1, name: "minico" }),
    ).toBeVisible();
    expect(screen.getByLabelText("bootstrap status")).toBeVisible();
    expect(screen.getByText(/Stage:/)).toBeVisible();
    expect(screen.getByLabelText("settings mock")).toBeVisible();
    expect(initializeWindowPlacementLifecycle).toHaveBeenCalledTimes(1);
    unmount();
    expect(persistWindowPlacement).toHaveBeenCalledTimes(1);
  });
});
