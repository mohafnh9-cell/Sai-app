import { describe, expect, it, vi } from "vitest";
import {
  attackCenterErrorFromSupabase,
  attackCenterErrorFromUnknown,
} from "../api/errors";
import { buildAttackCenterListResponse, buildAttackCenterDisabledResponse } from "../api/attack-center-contract";
import { AttackSimulationRepositoryError } from "../persistence/campaign-repository";

describe("attack center API errors", () => {
  it("maps missing ASE table to infrastructure_unavailable", () => {
    const error = attackCenterErrorFromSupabase({
      code: "42P01",
      message: 'relation "attack_simulation_campaigns" does not exist',
    });
    expect(error.status).toBe(503);
    expect(error.code).toBe("infrastructure_unavailable");
  });

  it("maps repository infrastructure errors to 503", () => {
    const error = attackCenterErrorFromUnknown(
      new AttackSimulationRepositoryError("missing table", "infrastructure", "PGRST205")
    );
    expect(error.status).toBe(503);
    expect(error.code).toBe("infrastructure_unavailable");
  });
});

describe("attack center contract", () => {
  it("returns empty successful response with capability when org is allowlisted", () => {
    process.env.SEQURAI_INTERNAL_ORG_IDS =
      "00000000-0000-4000-8000-000000000001";
    const body = buildAttackCenterListResponse({
      organizationId: "00000000-0000-4000-8000-000000000001",
      campaigns: [],
      activeCampaign: null,
    });
    expect(body.ok).toBe(true);
    expect(body.campaigns).toEqual([]);
    expect(body.activeCampaign).toBeNull();
    expect(body.capability.enabled).toBe(true);
  });

  it("returns disabled capability when attack simulation is internal-only", async () => {
    vi.resetModules();
    vi.stubEnv("SEQURAI_FEATURE_FLAGS_JSON", JSON.stringify({ attack_simulation: "internal" }));
    vi.stubEnv("SEQURAI_INTERNAL_ORG_IDS", "");
    const { buildAttackCenterDisabledResponse: buildDisabled } = await import("../api/attack-center-contract");
    const body = buildDisabled({
      organizationId: "00000000-0000-4000-8000-000000000099",
    });
    vi.unstubAllEnvs();
    vi.resetModules();
    expect(body.ok).toBe(true);
    expect(body.campaigns).toEqual([]);
    expect(body.capability.enabled).toBe(false);
    expect(body.capability.reason).toBe("internal_only");
  });
});

describe("loadAttackCenterListState", () => {
  function createAdminMock(options: {
    listResult: { data: unknown; error: unknown };
    latestResult?: { data: unknown; error: unknown };
  }) {
    return {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(
          options.latestResult ?? { data: null, error: null }
        ),
      })),
    };
  }

  it("returns empty collection for project with no campaigns", async () => {
    const { loadAttackCenterListState } = await import("../api/load-attack-center-list");
    process.env.SEQURAI_INTERNAL_ORG_IDS =
      "22222222-2222-4222-8222-222222222222";

    const listChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const latestChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    let call = 0;
    const admin = {
      from: vi.fn(() => {
        call += 1;
        return call === 1 ? listChain : latestChain;
      }),
    };

    const result = await loadAttackCenterListState(admin as never, {
      projectId: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result.ok).toBe(true);
    expect(result.campaigns).toEqual([]);
    expect(result.activeCampaign).toBeNull();
  });

  it("surfaces infrastructure errors instead of empty state", async () => {
    const { loadAttackCenterListState } = await import("../api/load-attack-center-list");
    const listChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "42P01", message: "relation does not exist" },
      }),
    };
    const admin = {
      from: vi.fn(() => listChain),
    };

    await expect(
      loadAttackCenterListState(admin as never, {
        projectId: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
      })
    ).rejects.toMatchObject({ code: "infrastructure" });
  });
});
