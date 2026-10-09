import { beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const FIX = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const state = vi.hoisted(() => ({
  lifecycleState: "APPLIED" as string,
  verifyImpl: null as null | (() => Promise<unknown>),
  calls: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));
vi.mock("@/server/security-scanner/admin-client", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/server/projects/project-access", () => ({
  requireProjectApiAccess: async () => ({ ok: true, userId: "user-1", project: { id: PROJECT, organization_id: "org-a", name: "p" } }),
}));
vi.mock("@/server/feature-flags", () => ({ isFeatureEnabled: () => false }));
vi.mock("@/server/analysis-runs/resolve-analysis-run-id-for-isolation", () => ({
  requestedAnalysisRunIdFromRequest: () => null,
  resolveAnalysisRunIdForIsolation: async () => ({ runId: null, invalidRequest: false }),
}));
vi.mock("@/server/safe-fix-engine/history", () => ({
  getSafeFixById: async () => ({ id: FIX, projectId: PROJECT, organizationId: "org-a", lifecycleState: state.lifecycleState }),
}));
vi.mock("@/server/safe-fix-engine/verify", () => ({
  approveSafeFix: async () => { state.calls.push("approve"); if (state.lifecycleState !== "READY") throw new Error(`invalid_transition:${state.lifecycleState}->APPROVED`); },
  reopenSafeFix: async () => { state.calls.push("reopen"); if (state.lifecycleState !== "FAILED") throw new Error(`invalid_transition:${state.lifecycleState}->READY`); },
  markSafeFixApplied: async () => { state.calls.push("applied"); throw new Error("proposal_commit_unsupported"); },
  verifySafeFix: async () => { state.calls.push("verify"); if (state.verifyImpl) return state.verifyImpl(); return { outcome: "passed" }; },
}));

import { POST } from "../route";

const call = (body: unknown) =>
  POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: PROJECT, safeFixId: FIX }),
  });

beforeEach(() => {
  state.lifecycleState = "APPLIED";
  state.verifyImpl = null;
  state.calls = [];
});

describe("POST safe-fixes/[safeFixId] -- verify is only valid from APPLIED", () => {
  it.each(["PROPOSED", "READY", "APPROVED", "VERIFYING", "VERIFIED", "FAILED", "SUPERSEDED"])(
    "verify on a %s record -> controlled 409, verifySafeFix is never called (nothing is written)",
    async (lifecycleState) => {
      state.lifecycleState = lifecycleState;
      const response = await call({ action: "verify" });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: `invalid_transition:${lifecycleState}->VERIFYING` });
      expect(state.calls).toEqual([]);
    }
  );

  it("the default action (no action given) is verify and obeys the same rule", async () => {
    state.lifecycleState = "READY";
    expect((await call({})).status).toBe(409);
    expect(state.calls).toEqual([]);
  });

  it("verify on an APPLIED record still verifies (200)", async () => {
    const response = await call({ action: "verify" });
    expect(response.status).toBe(200);
    expect(state.calls).toEqual(["verify"]);
  });

  it("a race that changes the state after the check is refused inside the engine -> 409, not 500", async () => {
    state.verifyImpl = async () => { throw new Error("invalid_transition:VERIFIED->VERIFYING"); };
    const response = await call({ action: "verify" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "invalid_transition:VERIFIED->VERIFYING" });
  });

  it("an unexpected engine failure is NOT disguised as a 409", async () => {
    state.verifyImpl = async () => { throw new Error("database exploded"); };
    await expect(call({ action: "verify" })).rejects.toThrow("database exploded");
  });
});

describe("other actions share the same controlled mapping", () => {
  it("approve on a VERIFIED record -> 409 (was an unhandled 500)", async () => {
    state.lifecycleState = "VERIFIED";
    expect((await call({ action: "approve" })).status).toBe(409);
  });
  it("reopen outside FAILED -> 409", async () => {
    state.lifecycleState = "READY";
    expect((await call({ action: "reopen" })).status).toBe(409);
  });
  it("applied with the migration missing -> 503", async () => {
    state.lifecycleState = "APPROVED";
    const response = await call({ action: "applied", commitSha: "b".repeat(40) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "proposal_commit_unsupported" });
  });
});
