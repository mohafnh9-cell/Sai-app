import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let lang: "en" | "es" = "en";
const lookup = (ns: string | undefined, key: string, params?: Record<string, unknown>) => {
  const segs = key.split(".");
  const namespace = ns ?? segs.shift()!;
  let node: unknown = JSON.parse(readFileSync(`messages/${lang}/${namespace}.json`, "utf8"));
  for (const part of segs) node = (node as Record<string, unknown>)?.[part];
  if (typeof node !== "string") throw new Error(`missing i18n key ${lang}:${namespace}.${segs.join(".")}`);
  return node.replace(/\{(\w+)\}/g, (_m, k) => String(params?.[k] ?? ""));
};
vi.mock("@/lib/i18n/client", () => ({
  useI18n: (ns?: string) => ({ t: (key: string, params?: Record<string, unknown>) => lookup(ns, key, params), locale: lang }),
}));
vi.mock("@/features/continuous-protection/hooks/useToggleContinuousProtection", () => ({
  useToggleContinuousProtection: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { MissionControlProtectionStatus } from "../components/MissionControlProtectionStatus";
import { deploymentRecommendationText, mapVerdictDisplay } from "../lib/build-mission-control-view";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { PRODUCTION_VERDICT_VERSION } from "@/brain/production-verdict/schema";
import { protectionDecisionFor } from "@/brain/production-verdict/protection-decision";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const area = (key: string) => ({ key, label: key, score: null, status: "not_evaluated", confidence: "low", limitations: "", methodology: "", evidenceCount: 0 });

function verdict(over: Partial<ProductionVerdictV1>): ProductionVerdictV1 {
  return {
    version: PRODUCTION_VERDICT_VERSION, projectId: uuid(1), repositoryId: uuid(1), scanId: uuid(2), commitSha: "d1e1211", branch: "main",
    status: "ready_to_ship", score: 100, previousScore: null, scoreDelta: null, projectedScore: 100, projectedScoreIsEstimate: true,
    blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, estimatedFixMinutes: 0, confidence: "high", executiveSummary: "s",
    topPriorities: [], evaluatedAreas: [], partiallyEvaluatedAreas: [], unevaluatedAreas: [], introducedBlockers: 0, resolvedBlockers: 0,
    coverageRatio: 1, filesAnalyzed: 13, findingsCount: 0, recommendedAction: "r", methodologyNote: "m", generatedAt: new Date().toISOString(), ...over,
  } as ProductionVerdictV1;
}
const limited = () => verdict({ confidence: "low", unevaluatedAreas: [area("testing")] as never });
const approved = () => verdict({});
const blocked = () => verdict({ status: "not_ready", score: 0, confidence: "low", blockersCount: 10, criticalBlockersCount: 1, highBlockersCount: 9 });
const tokenAiCurrent = () => verdict({ status: "insufficient_data", score: 32, confidence: "low", blockersCount: 10, criticalBlockersCount: 1, highBlockersCount: 9 });

const t = (l: "en" | "es") => (key: string) => { lang = l; return lookup("missionControl", key); };
const BLOCKER_MSG = /blockers are resolved|resolver los bloqueos/i;

describe.each(["en", "es"] as const)("Protection panel never implies confidence it does not have [%s]", (l) => {
  const panel = (v: ProductionVerdictV1) => {
    lang = l;
    const model = {
      projectId: "p", status: "REQUIRES_ATTENTION", decision: protectionDecisionFor({ verdict: v, reviewInProgress: false }), safeFix: null,
      statusHeadline: "", productionConfidence: 100, securityConfidence: 100, healthScore: 100, healthLabel: "healthy", protectionHealth: "healthy",
      productionHealth: "healthy", securityHealth: "healthy", worriesTop3: [], recommendation: "", lastCheckedAt: null, continuousProtectionEnabled: true,
      continuousProtectionPaused: false, confidenceTrend30d: [], weeklySummaryPreview: null,
    } as never;
    return renderToStaticMarkup(createElement(MissionControlProtectionStatus, { model })).replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  };

  it("A. LOW canonical confidence + a 100 metric: the metric is labelled a score, never 'confidence'", () => {
    const text = panel(limited());
    expect(text).toMatch(/100\/100/);
    expect(text).toMatch(/score|puntuaci[oó]n/i);
    expect(text).not.toMatch(/confidence|confianza/i);
  });

  it("the same holds for NOT_READY and genuinely approved postures", () => {
    for (const v of [blocked(), approved(), tokenAiCurrent()]) expect(panel(v)).not.toMatch(/confidence|confianza/i);
  });
});

describe.each(["en", "es"] as const)("Evidence card recommendation follows blockers + canonical posture [%s]", (l) => {
  const text = (v: ProductionVerdictV1 | null) => {
    const tr = t(l);
    return deploymentRecommendationText(v, mapVerdictDisplay(v, tr as never), tr as never);
  };

  it("B. 0 blockers + limited evidence: no 'resolve blockers' message", () => {
    const out = text(limited());
    expect(out).not.toMatch(BLOCKER_MSG);
    expect(out).toBe(t(l)("verdict.deploymentRecommendation.evidenceLimited"));
    expect(out).toMatch(/evidence|evidencia/i);
  });

  it("C. blockers > 0: blocker language remains (NOT_READY and the current TokenAi insufficient_data with 10 blockers)", () => {
    for (const v of [blocked(), tokenAiCurrent()]) expect(text(v)).toBe(t(l)("verdict.deploymentRecommendation.blocked"));
  });

  it("D. genuinely approved posture keeps the approved copy", () => {
    expect(text(approved())).toBe(t(l)("verdict.deploymentRecommendation.safe"));
  });

  it("no verdict yet: not a blocker message either", () => {
    const out = text(null);
    expect(out).not.toMatch(BLOCKER_MSG);
    expect(out).toBe(t(l)("verdict.deploymentRecommendation.noVerdict"));
  });

  it("insufficient evidence with 0 blockers is evidence-limited, not 'blocked'", () => {
    const out = text(verdict({ status: "insufficient_data", score: null, confidence: "low" }));
    expect(out).not.toMatch(BLOCKER_MSG);
  });
});

describe("no user-facing text calls a score 'confidence' (source guard)", () => {
  const SCOPES = ["server/continuous-protection", "server/protection-reports", "server/security-alerts", "server/production-memory", "features/mission-control", "features/continuous-protection"];
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "__tests__" || name === "node_modules") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(path);
    }
    return out;
  }
  it("'Production confidence' / 'Security confidence' do not appear as user-facing wording", () => {
    const offenders = SCOPES.flatMap((s) => walk(s)).filter((f) => /(production|security) confidence/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("the protection labels in both languages say score", () => {
    for (const l of ["en", "es"] as const) {
      const d = JSON.parse(readFileSync(`messages/${l}/missionControl.json`, "utf8")).protection;
      for (const key of ["productionConfidence", "securityConfidence"]) expect(String(d[key])).not.toMatch(/confidence|confianza/i);
    }
  });
});
