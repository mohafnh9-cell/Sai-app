import { beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({ result: null as unknown }));

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
vi.mock("@/server/safe-fix-engine/generate", () => ({ generateSafeFix: async () => state.result }));
vi.mock("@/server/safe-fix-engine/history", () => ({ listSafeFixHistory: async () => [] }));

import { POST } from "../route";

const call = () =>
  POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ priorityId: "priority-1" }) }), {
    params: Promise.resolve({ id: PROJECT }),
  });

beforeEach(() => { state.result = null; });

describe("POST /safe-fixes (create) reports a repeat or a conflict explicitly", () => {
  it("a new proposal -> 200 with the record", async () => {
    state.result = { status: "ready", record: { id: "r1" } };
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ status: "ready", record: { id: "r1" } });
  });

  it("a reused proposal -> 200 flagged reused (idempotent repeat)", async () => {
    state.result = { status: "ready", record: { id: "r1" }, reused: true };
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ status: "ready", reused: true });
  });

  it("a correction already in flight on another analysis -> 409 with the kept record, nothing created", async () => {
    state.result = { status: "in_flight", record: { id: "r1", lifecycleState: "APPROVED" }, reason: "different_base_analysis" };
    const response = await call();
    expect(response.status).toBe(409);
    expect((await response.json()).result).toMatchObject({ status: "in_flight", record: { id: "r1", lifecycleState: "APPROVED" } });
  });
});
