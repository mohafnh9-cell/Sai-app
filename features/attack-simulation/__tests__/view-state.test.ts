import { describe, expect, it } from "vitest";
import { resolveViewState } from "../view-state";

describe("Attack Center view state", () => {
  it("never treats error and empty as simultaneous states", () => {
    const errorState = resolveViewState({
      loading: false,
      capability: { enabled: true, runtimeModes: ["mock"] },
      error: { status: 500, fatal: false, message: "failed" },
      snapshot: null,
    });
    expect(errorState.kind).toBe("error");

    const emptyState = resolveViewState({
      loading: false,
      capability: { enabled: true, runtimeModes: ["mock"] },
      error: null,
      snapshot: null,
    });
    expect(emptyState.kind).toBe("empty");
  });

  it("prefers disabled capability over empty", () => {
    const state = resolveViewState({
      loading: false,
      capability: { enabled: false, runtimeModes: [], reason: "beta_not_enabled" },
      error: null,
      snapshot: null,
    });
    expect(state.kind).toBe("disabled");
  });
});
