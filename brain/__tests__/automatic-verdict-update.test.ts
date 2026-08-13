import { describe, expect, it } from "vitest";
import {
  buildFinalizeFailure,
  buildFinalizeSuccess,
  shouldFinalizeAutomaticVerdict,
} from "@/brain/automatic-verdict-update";
import { buildProductionIntelligence } from "@/brain/production-intelligence";
import { buildProductionJourney, type VerdictJourneyRecord } from "@/brain/production-journey";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { PRODUCTION_VERDICT_VERSION } from "@/brain/production-verdict/schema";
import { productionReadyFromVerdict } from "@/server/brain/verdict-view-model";
import { loadNamespace } from "@/lib/i18n/load-messages";

const VALID_COMMIT = "8a5f92bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function uuid(n: number): string {
  return `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function baseVerdict(overrides: Partial<ProductionVerdictV1> = {}): ProductionVerdictV1 {
  return {
    version: PRODUCTION_VERDICT_VERSION,
    projectId: uuid(1),
    repositoryId: uuid(1),
    scanId: uuid(2),
    commitSha: VALID_COMMIT,
    branch: "main",
    status: "needs_improvement",
    score: 60,
    previousScore: 50,
    scoreDelta: 10,
    projectedScore: 75,
    projectedScoreIsEstimate: true,
    blockersCount: 2,
    criticalBlockersCount: 1,
    highBlockersCount: 1,
    estimatedFixMinutes: 30,
    confidence: "high",
    executiveSummary: "Summary",
    topPriorities: [
      {
        id: "p1",
        rank: 1,
        title: "Protect your admin endpoint",
        category: "authentication",
        reason: "Admin route lacks auth",
        severity: "high",
        confidence: "high",
        estimatedMinutes: 20,
        estimatedTimeLabel: "20m",
        projectedScoreImpact: 8,
        affectedFiles: [],
        recommendedAction: "Add auth",
        findingIds: ["finding-1"],
      },
    ],
    evaluatedAreas: [],
    partiallyEvaluatedAreas: [],
    unevaluatedAreas: [],
    introducedBlockers: 0,
    resolvedBlockers: 1,
    coverageRatio: 0.8,
    filesAnalyzed: 10,
    findingsCount: 2,
    recommendedAction: "Protect your admin endpoint",
    methodologyNote: "Note",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

type RecordInput = Partial<Omit<VerdictJourneyRecord, "verdict">> & {
  verdict?: Partial<ProductionVerdictV1>;
};

function record(index: number, overrides: RecordInput = {}): VerdictJourneyRecord {
  const generatedAt = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
  const verdictOverrides = overrides.verdict ?? {};
  const verdict = baseVerdict({
    scanId: uuid(100 + index),
    generatedAt,
    ...verdictOverrides,
  });
  const { verdict: _v, ...rest } = overrides;
  return {
    id: uuid(1000 + index),
    scanId: verdict.scanId,
    projectId: verdict.projectId,
    repositoryId: verdict.repositoryId,
    generatedAt,
    commitSha: verdict.commitSha,
    branch: verdict.branch,
    status: verdict.status,
    score: verdict.score,
    previousScore: verdict.previousScore,
    scoreDelta: verdict.scoreDelta,
    blockersCount: verdict.blockersCount,
    introducedBlockers: verdict.introducedBlockers,
    resolvedBlockers: verdict.resolvedBlockers,
    verdict,
    ...rest,
  };
}

describe("Block 7.0.3 automatic verdict finalize rules", () => {
  it("finalizes only completed automatic reviews with a valid commit", () => {
    expect(
      shouldFinalizeAutomaticVerdict({
        id: uuid(1),
        status: "completed",
        review_type: "automatic",
        commit_sha: VALID_COMMIT,
        security_score: 72,
        findings_count: 3,
        completed_at: new Date().toISOString(),
      })
    ).toEqual({ shouldFinalize: true });
  });

  it("rejects manual reviews and failed scans", () => {
    expect(
      shouldFinalizeAutomaticVerdict({
        id: uuid(1),
        status: "completed",
        review_type: "manual",
        commit_sha: VALID_COMMIT,
        security_score: 72,
        findings_count: 3,
        completed_at: new Date().toISOString(),
      })
    ).toEqual({ shouldFinalize: false, errorCode: "missing_review" });

    expect(
      shouldFinalizeAutomaticVerdict({
        id: uuid(1),
        status: "failed",
        review_type: "automatic",
        commit_sha: VALID_COMMIT,
        security_score: null,
        findings_count: null,
        completed_at: null,
      })
    ).toEqual({ shouldFinalize: false, errorCode: "automatic_review_failed" });
  });

  it("rejects missing commit metadata", () => {
    expect(
      shouldFinalizeAutomaticVerdict({
        id: uuid(1),
        status: "completed",
        review_type: "automatic",
        commit_sha: null,
        security_score: 72,
        findings_count: 3,
        completed_at: new Date().toISOString(),
      })
    ).toEqual({ shouldFinalize: false, errorCode: "invalid_commit" });
  });

  it("builds structured finalize results", () => {
    expect(buildFinalizeSuccess(uuid(1))).toEqual({
      ok: true,
      errorCode: null,
      verdictUpdated: true,
      scanId: uuid(1),
    });
    expect(buildFinalizeFailure("verdict_generation_failed", uuid(2))).toEqual({
      ok: false,
      errorCode: "verdict_generation_failed",
      verdictUpdated: false,
      scanId: uuid(2),
    });
  });
});

describe("Block 7.0.3 project state after verdict update", () => {
  it("updates production intelligence from the latest verdict", () => {
    const journeyBefore = buildProductionJourney([
      record(0, { verdict: { score: 50, scoreDelta: null, blockersCount: 3 } }),
    ]);
    const journeyAfter = buildProductionJourney([
      record(0, { verdict: { score: 50, scoreDelta: null, blockersCount: 3 } }),
      record(1, {
        verdict: {
          score: 68,
          scoreDelta: 18,
          blockersCount: 1,
          status: "almost_ready",
        },
        blockersCount: 1,
        score: 68,
        scoreDelta: 18,
      }),
    ]);

    const previousVerdict = baseVerdict({ score: 50, blockersCount: 3 });
    const updatedVerdict = baseVerdict({
      score: 68,
      blockersCount: 1,
      status: "almost_ready",
      scoreDelta: 18,
    });

    const before = buildProductionIntelligence({
      journey: journeyBefore,
      verdict: previousVerdict,
    });
    const after = buildProductionIntelligence({
      journey: journeyAfter,
      verdict: updatedVerdict,
    });

    expect(before.currentScore).toBe(50);
    expect(after.currentScore).toBe(68);
    expect(after.currentStatus).toBe("almost_ready");
    expect(after.recommendedAction.priorityTitle).toBe("Protect your admin endpoint");
  });

  it("updates production journey timeline and score from new verdicts", () => {
    const journey = buildProductionJourney([
      record(0, { verdict: { score: 45, scoreDelta: null } }),
      record(1, { verdict: { score: 62, scoreDelta: 17, blockersCount: 2 } }),
    ]);

    expect(journey.currentScore).toBe(62);
    expect(journey.timeline).toHaveLength(2);
    expect(journey.validReviews).toBe(2);
  });

  it("feeds dashboard-ready production ready score from verdict", () => {
    const verdict = baseVerdict({ score: 82, status: "ready_to_ship", blockersCount: 0 });
    const ready = productionReadyFromVerdict(verdict);

    expect(ready.overall).toBe(82);
    expect(ready.readyForProduction).toBe(true);
    expect(ready.blockersCount).toBe(0);
  });
});

describe("Block 7.0.3 automatic verdict update i18n", () => {
  it("loads automaticVerdictUpdate errors in English and Spanish", () => {
    const en = loadNamespace("en", "automaticVerdictUpdate");
    const es = loadNamespace("es", "automaticVerdictUpdate");

    expect((en.errors as Record<string, string>).verdict_generation_failed).toContain("Verdict");
    expect((es.errors as Record<string, string>).verdict_generation_failed).toContain(
      "veredicto de producción"
    );
  });

  it("loads verdict updated copy on automatic review panel", () => {
    const en = loadNamespace("en", "automaticReview");
    const es = loadNamespace("es", "automaticReview");

    expect(en.verdictUpdated).toBe("Production Verdict updated.");
    expect(es.verdictUpdated).toBe("Veredicto de producción actualizado.");
  });
});
