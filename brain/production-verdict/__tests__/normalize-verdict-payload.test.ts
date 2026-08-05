import { describe, expect, it } from "vitest";
import { normalizeProductionVerdictPayload } from "@/brain/production-verdict/normalize-verdict-payload";
import { ProductionVerdictSchema, safeParseProductionVerdict } from "@/brain/production-verdict/schema";

describe("normalizeProductionVerdictPayload", () => {
  it("coerces legacy headline/summary fields and missing arrays", () => {
    const normalized = normalizeProductionVerdictPayload({
        version: "1.0.0",
        projectId: "11111111-1111-4111-8111-111111111111",
        repositoryId: "11111111-1111-4111-8111-111111111111",
        scanId: "22222222-2222-4222-8222-222222222222",
        commitSha: null,
        status: "not_ready",
        score: 55,
        previousScore: null,
        scoreDelta: null,
        projectedScore: null,
        blockersCount: 1,
        criticalBlockersCount: 1,
        highBlockersCount: 0,
        estimatedFixMinutes: 60,
        confidence: "medium",
        headline: "Fix auth before deploy",
        summary: "ignored",
        introducedBlockers: 0,
        resolvedBlockers: 0,
        coverageRatio: null,
        filesAnalyzed: 10,
        findingsCount: 1,
        recommended_action: "Patch auth middleware",
        methodology: "Static scan",
        generatedAt: "2026-08-05 06:00:00+00",
        topPriorities: [
          {
            id: "p1",
            rank: 1,
            title: "Auth gap",
            category: "auth",
            reason: "Missing guard",
            severity: "critical",
            confidence: "high",
            finding_ids: ["f1"],
          },
        ],
    });
    const parsed = safeParseProductionVerdict(normalized);
    const validation = ProductionVerdictSchema.safeParse(normalized);
    expect(validation.success, JSON.stringify(validation.success ? null : validation.error.issues)).toBe(true);
    expect(parsed?.executiveSummary).toBe("Fix auth before deploy");
    expect(parsed?.methodologyNote).toBe("Static scan");
    expect(parsed?.topPriorities[0]?.findingIds).toEqual(["f1"]);
  });
});
