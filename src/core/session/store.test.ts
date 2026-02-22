import { describe, expect, it } from "vitest";
import { initialSessionState } from "./store";

describe("initialSessionState", () => {
  it("exposes initial session metadata", () => {
    expect(initialSessionState).toEqual({
      appName: "minico",
      buildTarget: "desktop",
      authView: "loginRequired",
      currentThreadId: null,
      activeTurnId: null,
    });
  });
});
