import type { ProductionVerdictV1, VerdictStatus } from "@/brain/production-verdict/schema";

let counter = 0;
let rowCounter = 0;

/**
 * Builds a full `production_verdicts` row (all columns `loadVerdictJourneyRecords`
 * and `getCurrentProductionVerdict` expect), derived entirely from an already
 * built verdict so every test fixture stays internally consistent.
 */
export function verdictRow(
  projectId: string,
  verdict: ProductionVerdictV1,
  id?: string,
  organizationId = "org-a"
) {
  rowCounter += 1;
  return {
    id: id ?? `33333333-3333-4333-8333-33333333${String(rowCounter).padStart(4, "0")}`,
    organization_id: organizationId,
    project_id: projectId,
    repository_id: projectId,
    scan_id: verdict.scanId,
    status: verdict.status,
    score: verdict.score,
    previous_score: verdict.previousScore,
    score_delta: verdict.scoreDelta,
    blockers_count: verdict.blockersCount,
    introduced_blockers: verdict.introducedBlockers,
    resolved_blockers: verdict.resolvedBlockers,
    verdict,
    generated_at: verdict.generatedAt,
  };
}

export function buildVerdictFixture(overrides: Partial<ProductionVerdictV1> = {}): ProductionVerdictV1 {
  counter += 1;
  return {
    version: "1.0.0",
    projectId: "11111111-1111-4111-8111-111111111111",
    repositoryId: "11111111-1111-4111-8111-111111111111",
    scanId: `22222222-2222-4222-8222-22222222222${counter % 10}`,
    commitSha: `commit-${counter}`,
    branch: "main",

    status: "not_ready" as VerdictStatus,
    score: 64,
    previousScore: 58,
    scoreDelta: 6,
    projectedScore: 80,
    projectedScoreIsEstimate: true,

    blockersCount: 2,
    criticalBlockersCount: 1,
    highBlockersCount: 1,

    estimatedFixMinutes: 20,
    confidence: "high",

    executiveSummary: "Two production blockers remain.",
    topPriorities: [
      {
        id: "priority-1",
        rank: 1,
        title: "Protect the administrative endpoint",
        category: "authorization",
        reason: "Missing authorization check.",
        severity: "critical",
        confidence: "high",
        estimatedMinutes: 10,
        estimatedTimeLabel: "10 minutes",
        projectedScoreImpact: 12,
        affectedFiles: ["app/api/admin/route.ts"],
        recommendedAction: "Add an authorization check before the admin action runs.",
        findingIds: ["finding-1"],
      },
      {
        id: "priority-2",
        rank: 2,
        title: "Add rate limiting to the public API",
        category: "availability",
        reason: "No rate limiting configured.",
        severity: "high",
        confidence: "medium",
        estimatedMinutes: 10,
        estimatedTimeLabel: "10 minutes",
        projectedScoreImpact: 6,
        affectedFiles: ["app/api/public/route.ts"],
        recommendedAction: "Add rate limiting middleware.",
        findingIds: ["finding-2"],
      },
    ],

    evaluatedAreas: [],
    partiallyEvaluatedAreas: [],
    unevaluatedAreas: [],

    introducedBlockers: 0,
    resolvedBlockers: 0,

    coverageRatio: 0.8,
    filesAnalyzed: 40,
    findingsCount: 2,

    recommendedAction: "Do not ship until production blockers are resolved. Start with priority 1.",
    methodologyNote: "Deterministic rule-based scoring.",

    generatedAt: new Date(2026, 0, 1 + counter).toISOString(),
    ...overrides,
  };
}
