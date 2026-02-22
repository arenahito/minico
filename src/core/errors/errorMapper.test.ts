import { describe, expect, it } from "vitest";
import { mapErrorToUserFacing } from "./errorMapper";

describe("errorMapper", () => {
  it("maps codex spawn failures", () => {
    const mapped = mapErrorToUserFacing(
      "Failed to spawn app-server process: program not found",
    );
    expect(mapped.code).toBe("codex_spawn_failed");
  });

  it("maps overload errors", () => {
    const mapped = mapErrorToUserFacing("Overloaded");
    expect(mapped.code).toBe("overloaded");
  });

  it("falls back to unknown mapping", () => {
    const mapped = mapErrorToUserFacing("something odd");
    expect(mapped.code).toBe("unknown_error");
    expect(mapped.message).toContain("something odd");
  });
});

