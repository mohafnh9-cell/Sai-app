import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSecurityTimelineEvents, type SecurityTimelineCopy } from "../lib/build-security-timeline";
import { verdictStatusHeadline } from "@/lib/i18n/verdict-copy";
import { deploymentPostureOf } from "@/brain/production-verdict/deployment-posture";
import { PRODUCTION_VERDICT_VERSION, type ProductionVerdictV1 } from "@/brain/production-verdict/schema";

type Lang = "en" | "es";
const tAllFor = (lang: Lang) => (key: string): string => {
  const [ns, ...path] = key.split(".");
  let node: unknown = JSON.parse(readFileSync(`messages/${lang}/${ns}.json`, "utf8"));
  for (const part of path) node = (node as Record<string, unknown>)?.[part];
  if (typeof node !== "string") throw new Error(`missing ${lang}:${key}`);
  return node;
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const area = (key: string) => ({ key, label: key, score: null, status: "not_evaluated", confidence: "low", limitations: "", methodology: "", evidenceCount: 0 });
function verdict(over: Partial<ProductionVerdictV1>): ProductionVerdictV1 {
  return {
    version: PRODUCTION_VERDICT_VERSION, projectId: uuid(1), repositoryId: uuid(1), scanId: uuid(2), commitSha: "ea2371b", branch: "main",
    status: "ready_to_ship", score: 100, previousScore: null, scoreDelta: null, projectedScore: 100, projectedScoreIsEstimate: true,
    blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, estimatedFixMinutes: 0, confidence: "high", executiveSummary: "s",
    topPriorities: [], evaluatedAreas: [], partiallyEvaluatedAreas: [], unevaluatedAreas: [], introducedBlockers: 0, resolvedBlockers: 0,
    coverageRatio: 1, filesAnalyzed: 24, findingsCount: 0, recommendedAction: "r", methodologyNote: "m", generatedAt: "2026-10-07T10:38:47.725Z", ...over,
  } as ProductionVerdictV1;
}

const READY = () => verdict({});
const LIMITED = () => verdict({ confidence: "low", unevaluatedAreas: [area("testing")] as never });
const NOT_READY = () => verdict({ status: "not_ready", score: 0, confidence: "low", blockersCount: 10, criticalBlockersCount: 1, highBlockersCount: 9 });
const INSUFFICIENT = () => verdict({ status: "insufficient_data", score: null, confidence: "low" });

function timelineLabel(lang: Lang, v: ProductionVerdictV1) {
  const tAll = tAllFor(lang);
  const copy: SecurityTimelineCopy = {
    analysisRun: (s) => s,
    repositoryAnalyzed: "analyzed",
    findingsDetected: (n) => `${n} findings`,
    risksIntroduced: (n) => `${n} risks`,
    verdictUpdated: (headline) => `UPDATED: ${headline}`,
    // exactly what ProductionIntelligenceView wires in
    verdictHeadline: (status, affirms) => verdictStatusHeadline(status, tAll, affirms),
  };
  const state = { productionVerdict: v, analysisRuns: [], status: { lastAnalysisAt: v.generatedAt }, ui: { fixPromptContext: { findings: [] } } } as never;
  const event = buildSecurityTimelineEvents(state, copy).find((e) => e.id === "verdict-updated")!;
  return event;
}

const READY_WORDS = { en: /ready to ship/i, es: /listo para desplegar/i } as const;
const LIMITED_WORDS = { en: /evidence limited/i, es: /evidencia limitada/i } as const;
const NOT_READY_WORDS = { en: /not ready/i, es: /no listo/i } as const;

describe.each(["en", "es"] as const)("security timeline derives its wording from the canonical posture [%s]", (lang) => {
  it("READY (high confidence, complete coverage): approved wording and a success tone", () => {
    expect(deploymentPostureOf(READY())).toBe("ready");
    const event = timelineLabel(lang, READY());
    expect(event.label).toMatch(READY_WORDS[lang]);
    expect(event.label).not.toMatch(LIMITED_WORDS[lang]);
    expect(event.tone).toBe("success");
  });

  it("READY_EVIDENCE_LIMITED (ready_to_ship status without the evidence): conservative wording, never approved, not success", () => {
    expect(deploymentPostureOf(LIMITED())).toBe("ready_evidence_limited");
    const event = timelineLabel(lang, LIMITED());
    expect(event.label).toMatch(LIMITED_WORDS[lang]);
    expect(event.label).not.toMatch(/(ready to ship|listo para desplegar)/i);
    expect(event.tone).not.toBe("success");
  });

  it("NOT_READY: not-ready wording and a danger tone", () => {
    const event = timelineLabel(lang, NOT_READY());
    expect(event.label).toMatch(NOT_READY_WORDS[lang]);
    expect(event.label).not.toMatch(LIMITED_WORDS[lang]);
    expect(event.tone).toBe("danger");
  });

  it("insufficient data: conservative non-approval wording", () => {
    const event = timelineLabel(lang, INSUFFICIENT());
    expect(event.label).not.toMatch(/(^|\s)(ready to ship|listo para desplegar)(\s|$)/i);
    expect(event.tone).not.toBe("success");
  });

  it("a headline helper called without the canonical flag (a status-only caller) can never read as approved", () => {
    const tAll = tAllFor(lang);
    expect(verdictStatusHeadline("ready_to_ship", tAll)).toMatch(LIMITED_WORDS[lang]);
    expect(verdictStatusHeadline("ready_to_ship", tAll, false)).toMatch(LIMITED_WORDS[lang]);
    expect(verdictStatusHeadline("ready_to_ship", tAll, true)).toMatch(READY_WORDS[lang]);
  });
});
