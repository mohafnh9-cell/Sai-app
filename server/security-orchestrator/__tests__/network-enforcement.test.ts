import { afterEach, describe, expect, it, vi } from "vitest";
import { isNetworkEgressEnforced } from "../network-enforcement";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Phase 36 -- isNetworkEgressEnforced (section 15)", () => {
  it("defaults to false -- descriptive network_policy is never mistaken for a real control", () => {
    vi.stubEnv("SECURITY_WORKER_NETWORK_ENFORCEMENT_VERIFIED", "");
    expect(isNetworkEgressEnforced()).toBe(false);
  });

  it("is true ONLY with the explicit operator attestation env var set to the literal string 'true'", () => {
    vi.stubEnv("SECURITY_WORKER_NETWORK_ENFORCEMENT_VERIFIED", "yes");
    expect(isNetworkEgressEnforced()).toBe(false);
    vi.stubEnv("SECURITY_WORKER_NETWORK_ENFORCEMENT_VERIFIED", "true");
    expect(isNetworkEgressEnforced()).toBe(true);
  });
});
