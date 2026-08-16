import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getCiStatus } from "@/app/api/projects/[id]/ci/status/route";
import { POST as postCiScan } from "@/app/api/projects/[id]/ci/scan/route";
import { enforceRateLimit, resetRateLimitStateForTests } from "@/server/http/rate-limit";

vi.mock("@/server/ci/ci-access", () => ({
  requireCiProjectAccess: vi.fn(),
}));

vi.mock("@/server/ci/ci-enforcement-service", () => ({
  getCiEnforcementStatus: vi.fn(),
  ensureCiScan: vi.fn(),
}));

import { requireCiProjectAccess } from "@/server/ci/ci-access";
import { getCiEnforcementStatus, ensureCiScan } from "@/server/ci/ci-enforcement-service";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const COMMIT = "abc123def4567890abcdef1234567890abcdef12";

describe("CI route rate limiting", () => {
  beforeEach(() => {
    resetRateLimitStateForTests();
    vi.mocked(requireCiProjectAccess).mockReset();
    vi.mocked(getCiEnforcementStatus).mockReset();
    vi.mocked(ensureCiScan).mockReset();
  });

  it("returns 429 when rate limit exceeded on /ci/status", async () => {
    vi.mocked(requireCiProjectAccess).mockResolvedValue({
      ok: true,
      access: {
        project: { id: PROJECT, organization_id: ORG, github_repo: "o/r" },
        userId: "u1",
        admin: {} as never,
        authSource: "api_key",
      },
    });
    vi.mocked(getCiEnforcementStatus).mockResolvedValue({} as never);

    const url = `https://example.com/api/projects/${PROJECT}/ci/status?commitSha=${COMMIT}`;
    for (let i = 0; i < 120; i++) {
      const probe = new NextRequest(url, { headers: { "x-forwarded-for": "10.0.0.99" } });
      enforceRateLimit(probe);
    }

    const request = new NextRequest(url, { headers: { "x-forwarded-for": "10.0.0.99" } });
    const response = await getCiStatus(request, { params: Promise.resolve({ id: PROJECT }) });
    expect(response.status).toBe(429);
  });

  it("returns 400 for missing commitSha query", async () => {
    vi.mocked(requireCiProjectAccess).mockResolvedValue({
      ok: true,
      access: {
        project: { id: PROJECT, organization_id: ORG, github_repo: "o/r" },
        userId: "u1",
        admin: {} as never,
        authSource: "session",
      },
    });

    const request = new NextRequest(`https://example.com/api/projects/${PROJECT}/ci/status`);
    const response = await getCiStatus(request, { params: Promise.resolve({ id: PROJECT }) });
    expect(response.status).toBe(400);
  });

  it("returns 401 when access denied", async () => {
    vi.mocked(requireCiProjectAccess).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401 }),
    });

    const request = new NextRequest(`https://example.com/api/projects/${PROJECT}/ci/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.100" },
      body: JSON.stringify({ commitSha: COMMIT }),
    });
    const response = await postCiScan(request, { params: Promise.resolve({ id: PROJECT }) });
    expect(response.status).toBe(401);
  });
});
