import type { AttackCenterSnapshot } from "./types";
import type { AttackCenterCapability, AttackCenterRefreshError } from "./api-types";

export type AttackCenterViewState =
  | { kind: "loading" }
  | { kind: "disabled"; capability: AttackCenterCapability }
  | { kind: "error"; error: AttackCenterRefreshError }
  | { kind: "empty" }
  | { kind: "content"; snapshot: AttackCenterSnapshot };

export function resolveViewState(input: {
  loading: boolean;
  capability: AttackCenterCapability | null;
  error: AttackCenterRefreshError | null;
  snapshot: AttackCenterSnapshot | null;
}): AttackCenterViewState {
  if (input.loading && !input.snapshot && !input.error) {
    return { kind: "loading" };
  }
  if (input.capability && !input.capability.enabled) {
    return { kind: "disabled", capability: input.capability };
  }
  if (input.error) {
    return { kind: "error", error: input.error };
  }
  if (!input.snapshot) {
    return { kind: "empty" };
  }
  return { kind: "content", snapshot: input.snapshot };
}
