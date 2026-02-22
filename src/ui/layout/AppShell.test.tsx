import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders the bootstrap status screen", () => {
    render(<AppShell />);
    expect(
      screen.getByRole("heading", { level: 1, name: "minico" }),
    ).toBeVisible();
    expect(screen.getByLabelText("bootstrap status")).toBeVisible();
    expect(screen.getByText(/Stage:/)).toBeVisible();
  });
});
