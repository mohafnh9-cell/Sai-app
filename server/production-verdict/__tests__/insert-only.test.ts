import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

const SCAN_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";

const { validVerdict } = vi.hoisted(() => {
  function validVerdict(overrides: Partial<ProductionVerdictV1> = {}): ProductionVerdictV1 {
    return {
      version: "1.0.0",
      projectId: PROJECT_ID,
      repositoryId: PROJECT_ID,
      scanId: SCAN_ID,
      commitSha: "abc123",
      branch: "main",
      status: "ready_to_ship",
      score: 90,
      previousScore: null,
      scoreDelta: null,
      projectedScore: null,
      projectedScoreIsEstimate: false,
      blockersCount: 0,
      criticalBlockersCount: 0,
      highBlockersCount: 0,
      estimatedFixMinutes: 0,
      confidence: "high",
      executiveSummary: "Ready",
      topPriorities: [],
      evaluatedAreas: [],
      partiallyEvaluatedAreas: [],
      unevaluatedAreas: [],
      introducedBlockers: 0,
      resolvedBlockers: 0,
      coverageRatio: 1,
      filesAnalyzed: 10,
      findingsCount: 0,
      recommendedAction: "Ship",
      methodologyNote: "test",
      generatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }
  return { validVerdict };
});

import { generateAndPersistProductionVerdict } from "../core";
import { generateProductionVerdict } from "@/brain/production-verdict/engine";

vi.mock("@/brain/production-verdict/engine", () => ({
  generateProductionVerdict: vi.fn(() => ({
    verdict: validVerdict({ status: "not_ready", score: 50 }),
  })),
}));

vi.mock("@/brain/production-verdict/finalize-verdict", () => ({
  finalizeProductionVerdict: vi.fn(({ verdict }) => verdict),
}));

vi.mock("@/server/attack-simulation/integration/build-verdict-overlay", () => ({
  buildAttackSimulationVerdictOverlay: vi.fn(async () => null),
}));

vi.mock("@/server/observability/operational-events", () => ({
  emitOperationalEvent: vi.fn(async () => undefined),
}));

vi.mock("@/server/observability/idempotency", () => ({
  buildIdempotencyKey: vi.fn(() => "key"),
  hasCompletedSideEffect: vi.fn(async () => false),
  recordSideEffect: vi.fn(async () => undefined),
}));

vi.mock("@/server/production-memory/record-writes", () => ({
  recordReviewCompletedMemory: vi.fn(async () => undefined),
}));

function buildAdmin(input: {
  existingVerdict?: ProductionVerdictV1 | null;
  immutabilityLockedAt?: string | null;
}) {
  let insertCalled = false;
  const scanRow = {
    id: SCAN_ID,
    project_id: PROJECT_ID,
    repository_id: PROJECT_ID,
    status: "completed",
    commit_sha: "abc123",
    branch: "main",
    security_score: 90,
    files_analyzed: 10,
    files_discovered: 10,
    immutability_locked_at: input.immutabilityLockedAt ?? null,
  };

  return {
    admin: {
      from: (table: string) => {
        if (table === "scans") {
          return {
            select: () => ({
              eq: (col: string) => {
                if (col === "id") {
                  return {
                    eq: () => ({
                      maybeSingle: async () => ({ data: scanRow, error: null }),
                    }),
                  };
                }
                return {
                  eq: () => ({
                    neq: () => ({
                      order: () => ({
                        limit: () => ({
                          maybeSingle: async () => ({ data: null, error: null }),
                        }),
                      }),
                    }),
                  }),
                };
              },
            }),
          };
        }
        if (table === "scan_findings") {
          return {
            select: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          };
        }
        if (table === "production_verdicts") {
          return {
            select: () => ({
              eq: (col: string, val: string) => {
                const chain = {
                  eq: (col2: string, val2: string) => {
                    if (
                      col === "organization_id" &&
                      val === ORG_ID &&
                      col2 === "scan_id" &&
                      val2 === SCAN_ID &&
                      input.existingVerdict
                    ) {
                      return {
                        maybeSingle: async () => ({
                          data: { id: "verdict-row", verdict: input.existingVerdict },
                          error: null,
                        }),
                      };
                    }
                    if (col === "organization_id" && col2 === "project_id") {
                      return {
                        order: () => ({
                          limit: () => ({
                            maybeSingle: async () => ({ data: null, error: null }),
                          }),
                        }),
                      };
                    }
                    return {
                      maybeSingle: async () => ({ data: null, error: null }),
                    };
                  },
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                  maybeSingle: async () => ({ data: null, error: null }),
                };
                if (col === "scan_id" && val === SCAN_ID && input.existingVerdict) {
                  return {
                    eq: () => ({
                      maybeSingle: async () => ({
                        data: { id: "verdict-row", verdict: input.existingVerdict },
                        error: null,
                      }),
                    }),
                    maybeSingle: async () => ({
                      data: { id: "verdict-row", verdict: input.existingVerdict },
                      error: null,
                    }),
                  };
                }
                if (col === "project_id") {
                  return chain;
                }
                return chain;
              },
            }),
            insert: () => {
              insertCalled = true;
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: "verdict-new" },
                    error: null,
                  }),
                }),
              };
            },
          };
        }
        if (table === "ai_reports") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "repository_scan_state") {
          return {
            upsert: async () => ({ error: null }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never,
    insertCalled: () => insertCalled,
  };
}

describe("generateAndPersistProductionVerdict insert-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not insert when verdict already exists for scan", async () => {
    const { admin, insertCalled } = buildAdmin({ existingVerdict: validVerdict() });

    const result = await generateAndPersistProductionVerdict(admin, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      scanId: SCAN_ID,
    });

    expect(result?.status).toBe("ready_to_ship");
    expect(insertCalled()).toBe(false);
  });

  it("inserts when no verdict exists for scan", async () => {
    const { admin, insertCalled } = buildAdmin({ existingVerdict: null });

    const result = await generateAndPersistProductionVerdict(admin, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      scanId: SCAN_ID,
    });

    expect(result?.status).toBe("not_ready");
    expect(insertCalled()).toBe(true);
  });

  it("returns existing verdict without re-running engine when scan is immutable", async () => {
    const { admin, insertCalled } = buildAdmin({
      existingVerdict: validVerdict(),
      immutabilityLockedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await generateAndPersistProductionVerdict(admin, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      scanId: SCAN_ID,
    });

    expect(result?.status).toBe("ready_to_ship");
    expect(insertCalled()).toBe(false);
    expect(generateProductionVerdict).not.toHaveBeenCalled();
  });
});
