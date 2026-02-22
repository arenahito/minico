import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

vi.mock("../settings/SettingsView", () => ({
  SettingsView: () => <section aria-label="settings mock">settings</section>,
}));

describe("AppShell", () => {
  it("renders the bootstrap status screen", () => {
    render(<AppShell />);
    expect(
      screen.getByRole("heading", { level: 1, name: "minico" }),
    ).toBeVisible();
    expect(screen.getByLabelText("bootstrap status")).toBeVisible();
    expect(screen.getByText(/Stage:/)).toBeVisible();
    expect(screen.getByLabelText("settings mock")).toBeVisible();
  });
});
