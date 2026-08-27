import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  upsertError: null as { message: string } | null,
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
vi.mock("@/server/http/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => null),
}));
vi.mock("@/server/cache/read-cache", () => ({
  cachedRead: vi.fn(async (_ns: string, _id: string, loader: () => unknown) => loader()),
  invalidateProjectCache: vi.fn(),
}));
vi.mock("@/server/continuous-protection/protection-context", () => ({
  getProtectionCenterModel: vi.fn(async () => ({
    projectId: "22222222-2222-4222-8222-222222222222",
    continuousProtectionEnabled: false,
    continuousProtectionPaused: false,
  })),
}));

const upsertMock = vi.fn(async () => ({ error: state.upsertError }));
vi.mock("@/server/security-scanner/admin-client", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({ upsert: upsertMock })),
  })),
}));

import { PATCH } from "@/app/api/projects/[id]/protection-center/route";

function patchRequest(body: unknown) {
  return new Request("https://example.com/api/projects/proj-1/protection-center", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/projects/[id]/protection-center", () => {
  beforeEach(() => {
    state.upsertError = null;
    upsertMock.mockClear();
  });

  it("rejects a non-boolean enabled value", async () => {
    const response = await PATCH(patchRequest({ enabled: "yes" }), {
      params: Promise.resolve({ id: "proj-1" }),
    });
    expect(response.status).toBe(400);
  });

  it("upserts enabled=true and clears paused_at", async () => {
    const response = await PATCH(patchRequest({ enabled: true }), {
      params: Promise.resolve({ id: "proj-1" }),
    });
    expect(response.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "proj-1",
        organization_id: "11111111-1111-4111-8111-111111111111",
        enabled: true,
        paused_at: null,
      }),
      { onConflict: "project_id" }
    );
  });

  it("returns 500 when the upsert fails", async () => {
    state.upsertError = { message: "db down" };
    const response = await PATCH(patchRequest({ enabled: false }), {
      params: Promise.resolve({ id: "proj-1" }),
    });
    expect(response.status).toBe(500);
  });
});
