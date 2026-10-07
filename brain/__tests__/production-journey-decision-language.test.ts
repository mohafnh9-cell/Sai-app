import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProductionJourney } from "@/brain/production-journey/build";
import { journeyOf, record, verdict, type Kind } from "./fixtures/journey-fixture";
import { detectMilestones } from "@/brain/production-journey/milestones";
import { calculateMaturity } from "@/brain/production-journey/maturity";
import { journeyMaturityKey, journeyPostureKey } from "@/brain/production-journey/decision-display";
import { buildProductionIntelligence } from "@/brain/production-intelligence";

type Lang = "en" | "es";
const label = (lang: Lang, key: string) => {
  let node: unknown = JSON.parse(readFileSync(`messages/${lang}/productionJourney.json`, "utf8"));
  for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
  if (typeof node !== "string") throw new Error(`missing ${lang}:${key}`);
  return node;
};
const APPROVAL = /production ready|production maintained|ready to ship|ready to deploy|lista para producci[oó]n|producci[oó]n mantenida|listo para desplegar|lista para desplegar|safe to deploy|ship it/i;
const maturityText = (lang: Lang, j: ReturnType<typeof journeyOf>, inProgress = false) => label(lang, `maturityValues.${journeyMaturityKey(j, inProgress)}`);
const postureText = (lang: Lang, j: ReturnType<typeof journeyOf>, inProgress = false) => label(lang, `posture.${journeyPostureKey(j, inProgress)}`);
const milestoneText = (lang: Lang, j: ReturnType<typeof journeyOf>) => j.milestones.map((m) => label(lang, m.titleKey)).join(" | ");

describe("Production Journey decision language is derived from the canonical posture (Phase 8I.1)", () => {
  it.each(["en", "es"] as const)("[%s] A/B/C. LOW + incomplete + score 100 + 0 blockers: no 'Production Ready', no 'Production Maintained', no 'Ready to Ship reached'", (lang) => {
    // five consecutive such reviews would have been "production_maintained" under the status-only rule
    for (const kinds of [["ready_low_incomplete"], ["ready_low_incomplete", "ready_low_incomplete", "ready_low_incomplete", "ready_low_incomplete", "ready_low_incomplete"], ["ready_medium_incomplete", "ready_medium_incomplete"]] as Kind[][]) {
      const j = journeyOf(kinds);
      expect(j.currentStatus).toBe("ready_to_ship"); // raw status is preserved as history
      expect(j.currentDeploymentPosture).toBe("ready_evidence_limited");
      expect(["production_ready", "production_maintained"]).not.toContain(j.maturity);
      expect(maturityText(lang, j)).not.toMatch(APPROVAL);
      expect(j.milestones.some((m) => m.type === "ready_to_ship")).toBe(false);
      expect(j.milestones.some((m) => m.titleKey === "milestones.readyToShip")).toBe(false);
      expect(milestoneText(lang, j)).not.toMatch(APPROVAL);
      expect(j.milestones.some((m) => m.type === "no_blockers_evidence_limited")).toBe(true); // history is not destroyed
      expect(postureText(lang, j)).not.toMatch(/^(ready to deploy|listo para desplegar)$/i);
      expect(j.milestones.map((m) => m.titleKey)).not.toContain("milestones.readyToShip"); // the approval milestone is still ahead
    }
  });

  it.each(["en", "es"] as const)("[%s] D. NOT_READY communicates not ready, never production ready", (lang) => {
    const j = journeyOf(["not_ready"]);
    expect(j.currentDeploymentPosture).toBe("not_ready");
    expect(postureText(lang, j)).toMatch(/not ready|no listo/i);
    expect(maturityText(lang, j)).not.toMatch(APPROVAL);
    expect(milestoneText(lang, j)).not.toMatch(APPROVAL);
  });

  it.each(["en", "es"] as const)("[%s] E. active scan / no final verdict: analysis in progress, previous posture is NOT presented as current", (lang) => {
    for (const kinds of [["ready_full", "ready_full"], ["ready_low_incomplete"], ["not_ready"]] as Kind[][]) {
      const j = journeyOf(kinds);
      expect(journeyPostureKey(j, true)).toBe("analysis_in_progress");
      expect(journeyMaturityKey(j, true)).toBe("analysis_in_progress");
      expect(postureText(lang, j, true)).toMatch(/in progress|en curso/i);
      expect(maturityText(lang, j, true)).not.toMatch(APPROVAL);
      expect(postureText(lang, j, true)).not.toMatch(APPROVAL);
    }
  });

  it("E'. unknown / insufficient / no verdict: conservative, never an approval", () => {
    const empty = journeyOf([]);
    expect(journeyPostureKey(empty, false)).toBe("no_decision");
    const insufficient = journeyOf(["insufficient"]);
    expect(insufficient.currentDeploymentPosture).toBe("more_analysis_required");
    for (const lang of ["en", "es"] as const) {
      expect(postureText(lang, empty)).not.toMatch(APPROVAL);
      expect(postureText(lang, insufficient)).not.toMatch(APPROVAL);
      expect(maturityText(lang, insufficient)).not.toMatch(APPROVAL);
    }
  });

  it.each(["en", "es"] as const)("[%s] F. genuinely ready (HIGH + complete + ready): Production Ready / Maintained and the Ready to Ship milestone remain available", (lang) => {
    const one = journeyOf(["ready_full", "ready_full"]);
    expect(one.currentDeploymentPosture).toBe("ready");
    expect(one.maturity).toBe("production_maintained");
    expect(maturityText(lang, one)).toMatch(APPROVAL);
    expect(one.milestones.some((m) => m.type === "ready_to_ship")).toBe(true);
    expect(postureText(lang, one)).toMatch(/ready to deploy|listo para desplegar/i);
    const single = journeyOf(["ready_full"]);
    expect(single.maturity).toBe("production_maintained"); // one review, canonical ready
    const afterLimited = journeyOf(["ready_low_incomplete", "ready_full"]);
    expect(afterLimited.maturity).toBe("production_ready"); // the earlier limited review is not "maintained" readiness
  });

  it("G. raw status without canonical approval posture never generates affirmative deployment language", () => {
    const common = { validReviews: 3, currentStatus: "ready_to_ship" as const, currentScore: 100, trend: "stable" as const, blockersResolved: 0 };
    const legacyTimeline = journeyOf(["ready_full", "ready_full", "ready_full"]).timeline.map((p) => ({ ...p, deploymentPosture: undefined }));
    for (const currentPosture of [undefined, null, "ready_evidence_limited", "more_analysis_required", "not_ready"] as const) {
      const maturity = calculateMaturity({ ...common, currentPosture, timeline: legacyTimeline });
      expect(["production_ready", "production_maintained"]).not.toContain(maturity);
    }
    // points that predate the posture field cannot mint the approval milestone either
    expect(detectMilestones(legacyTimeline).map((m) => m.type)).not.toContain("ready_to_ship");
    const stripped = { ...journeyOf(["ready_full"]), timeline: legacyTimeline.slice(0, 1) };
    expect(stripped.timeline[0]?.deploymentPosture).toBeUndefined();
    expect(calculateMaturity({ ...common, validReviews: 1, currentPosture: stripped.currentDeploymentPosture === "ready" ? undefined : null, timeline: stripped.timeline })).not.toBe("production_ready");
  });

  it("G'. production intelligence (insights / empty state / recommended action) is posture-gated too", () => {
    const limited = journeyOf(["ready_low_incomplete", "ready_low_incomplete"]);
    const intel = buildProductionIntelligence({ journey: limited, verdict: limited.timeline.length ? verdict("ready_low_incomplete", 1) : null });
    expect(intel.emptyState).not.toBe("ready_to_ship");
    expect(intel.insights.map((i) => i.id)).not.toContain("ready-to-ship");
    expect(intel.recommendedAction.type).not.toBe("maintain");
    const ready = journeyOf(["ready_full", "ready_full"]);
    const readyIntel = buildProductionIntelligence({ journey: ready, verdict: verdict("ready_full", 1) });
    expect(readyIntel.emptyState).toBe("ready_to_ship");
    expect(readyIntel.recommendedAction.type).toBe("maintain");
  });
});
