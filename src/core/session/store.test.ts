import { describe, expect, it } from "vitest";
import { initialSessionState } from "./store";

describe("initialSessionState", () => {
  it("exposes bootstrap metadata", () => {
    expect(initialSessionState).toEqual({
      stage: "bootstrap",
      appName: "minico",
      buildTarget: "desktop",
    });
  });
});
