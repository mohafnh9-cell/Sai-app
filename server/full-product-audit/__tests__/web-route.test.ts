import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
  })),
}));
vi.mock("@/server/projects/project-access", () => ({
  requireProjectApiAccess: vi.fn(async () => ({
    ok: true,
    userId: "user-1",
    project: {
      id: "22222222-2222-4222-8222-222222222222",
      organization_id: "11111111-1111-4111-8111-111111111111",
      name: "Demo",
    },
  })),
}));
vi.mock("@/server/security-scanner/admin-client", () => ({
  createAdminClient: vi.fn(() => state.admin),
}));
vi.mock("@/server/http/rate-limit", () => ({
  enforceRateLimit: vi.fn(() => null),
}));
vi.mock("@/server/full-product-audit", () => ({
  FullProductAuditError: class FullProductAuditError extends Error {},
  runFullProductAudit: vi.fn(async () => ({
    phase: "complete",
    verdictStatus: "needs_work",
    score: 72,
    timedOut: false,
    nextAction: "Review findings",
    engines: { securityTesting: { executionsRun: 1 } },
    dynamicVerification: { authorizedTarget: "https://preview.example.com" },
  })),
}));

import { runFullProductAudit } from "@/server/full-product-audit";
import { POST } from "@/app/api/projects/[id]/full-product-audit/route";

function projectAdmin() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: {
        name: "Demo",
        github_repo: "acme/demo",
        github_repository_id: 42,
      },
      error: null,
    })),
  };
  return { from: vi.fn(() => query) };
}

const params = Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" });

describe("web full product audit route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.admin = projectAdmin();
  });

  it("delegates the accepted web choice to the existing full product audit", async () => {
    const response = await POST(
      new Request("https://sequrai.example/api/projects/p/full-product-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dynamicVerificationDecision: "authorize" }),
      }),
      { params }
    );

    expect(response.status).toBe(200);
    expect(runFullProductAudit).toHaveBeenCalledWith(
      state.admin,
      expect.objectContaining({
        projectId: "22222222-2222-4222-8222-222222222222",
        dynamicVerificationDecision: "authorize",
      })
    );
    expect(JSON.stringify(await response.json())).not.toMatch(
      /authorizationId|runtimeMode|adapterId|maxRequestBudget/
    );
  });

  it("does not accept a URL as a direct audit target", async () => {
    const response = await POST(
      new Request("https://sequrai.example/api/projects/p/full-product-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetOrigin: "https://external.example.com" }),
      }),
      { params }
    );

    expect(response.status).toBe(400);
    expect(runFullProductAudit).not.toHaveBeenCalled();
  });
});
