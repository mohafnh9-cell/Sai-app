import { describe, expect, it } from "vitest";
import { legacyVerdictHeadline, toLegacyVerdict } from "@/brain/production-verdict/adapters/legacy";
import { PRODUCTION_VERDICT_VERSION, type ProductionVerdictV1 } from "@/brain/production-verdict/schema";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const area = (key: string) => ({ key, label: key, score: null, status: "not_evaluated", confidence: "low", limitations: "", methodology: "", evidenceCount: 0 });
function verdict(over: Record<string, unknown>): ProductionVerdictV1 {
  return {
    version: PRODUCTION_VERDICT_VERSION, projectId: uuid(1), repositoryId: uuid(1), scanId: uuid(2), commitSha: "ea2371b", branch: "main",
    status: "ready_to_ship", score: 100, previousScore: null, scoreDelta: null, projectedScore: 100, projectedScoreIsEstimate: true,
    blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, estimatedFixMinutes: 0, confidence: "high", executiveSummary: "s",
    topPriorities: [], evaluatedAreas: [], partiallyEvaluatedAreas: [], unevaluatedAreas: [], introducedBlockers: 0, resolvedBlockers: 0,
    coverageRatio: 1, filesAnalyzed: 24, findingsCount: 0, recommendedAction: "r", methodologyNote: "m", generatedAt: "2026-10-07T10:38:47.725Z", ...over,
  } as ProductionVerdictV1;
}
const EVIDENCE_LIMITED = "NO BLOCKERS FOUND — EVIDENCE LIMITED";

describe("legacy verdict headline derives from the canonical approval gate", () => {
  it("1. genuine READY (high confidence, complete coverage): READY TO SHIP is permitted", () => {
    const legacy = toLegacyVerdict(verdict({}));
    expect(legacy.headline).toBe("READY TO SHIP");
    expect(legacy.status).toBe("ready_for_production");
  });

  it("2. READY_EVIDENCE_LIMITED (low/medium confidence, unevaluated or partial areas): never READY TO SHIP", () => {
    for (const over of [{ confidence: "low" }, { confidence: "medium" }, { unevaluatedAreas: [area("testing")] }, { partiallyEvaluatedAreas: [area("performance")] }]) {
      expect(toLegacyVerdict(verdict(over)).headline).toBe(EVIDENCE_LIMITED);
    }
  });

  it("3-5. NOT_READY / INSUFFICIENT_DATA / FAILED keep their own conservative headlines", () => {
    expect(toLegacyVerdict(verdict({ status: "not_ready", confidence: "low", blockersCount: 3, criticalBlockersCount: 1 })).headline).toBe("NOT READY TO SHIP");
    expect(toLegacyVerdict(verdict({ status: "insufficient_data", score: null, confidence: "low" })).headline).toBe("MORE ANALYSIS REQUIRED");
    expect(toLegacyVerdict(verdict({ status: "analysis_failed", score: null, confidence: "low" })).headline).toBe("ANALYSIS FAILED");
  });

  it("7-8. missing/unreadable confidence or coverage never promotes the headline", () => {
    for (const over of [{ confidence: undefined }, { confidence: "bogus" }, { unevaluatedAreas: undefined }, { partiallyEvaluatedAreas: undefined }, { unevaluatedAreas: null }]) {
      expect(legacyVerdictHeadline({ ...verdict({}), ...over } as never)).toBe(EVIDENCE_LIMITED);
    }
  });

  it("no status other than a gated ready_to_ship can produce READY TO SHIP", () => {
    for (const status of ["almost_ready", "needs_improvement", "not_ready", "insufficient_data", "analysis_failed"]) {
      expect(legacyVerdictHeadline(verdict({ status }))).not.toBe("READY TO SHIP");
    }
  });

  it("10. structured machine-readable fields are unchanged (status mapping, v1, score)", () => {
    const limited = verdict({ confidence: "low", unevaluatedAreas: [area("testing")] });
    const legacy = toLegacyVerdict(limited);
    expect(legacy.status).toBe("ready_for_production"); // raw legacy status mapping kept
    expect(legacy.v1).toBe(limited);
    expect(legacy.v1.status).toBe("ready_to_ship");
    expect(legacy.score).toBe(100);
    expect(legacy.headline).toBe(EVIDENCE_LIMITED);
  });
});
