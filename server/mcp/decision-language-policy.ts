import type { ProductionVerdictV1, VerdictStatus } from "@/brain/production-verdict/schema";
import type { DeploymentDecision } from "./decision-mapping";

/**
 * The single, deterministic authority on how strongly a deployment decision
 * may be worded. It derives only from authoritative evidence state (verdict
 * status, confidence, area coverage, freshness, review lifecycle). It never
 * calls an LLM and never reads free text.
 *
 * INVARIANT: no decision-facing language (summary, overlay suffix, executive
 * summary, alert lead, tool text) may claim more certainty, safety or
 * deployability than this policy allows. AI/personality output may explain
 * but can only ever be weakened by this policy, never strengthened.
 */
export type DecisionStrength =
  | "BLOCKED" // do-not-deploy evidence
  | "INSUFFICIENT" // no answer possible (insufficient/failed/in progress/stale/unknown)
  | "QUALIFIED" // ready_to_ship classification, but confidence too low to recommend deploying
  | "SUPPORTED" // no blockers in evaluated areas; some areas not evaluated; qualified wording only
  | "HIGH_CONFIDENCE"; // ready, high confidence, all areas evaluated, current

export type DecisionLanguagePolicy = {
  strength: DecisionStrength;
  /** May the recommendation be SHIP_IT at all. */
  mayRecommendDeploy: boolean;
  /** "Safe to deploy", "Security Decision: Safe to deploy", "deploy with confidence". */
  canUseSafeToDeployLanguage: boolean;
  /** "I'm comfortable...", "I would ship this", "If this were my company...". */
  canUseFirstPersonDeploymentLanguage: boolean;
  /** "verified", "proven secure", "fully analyzed". */
  canUseVerifiedLanguage: boolean;
  /** Areas not (fully) evaluated; must be disclosed whenever > 0 and status is ready. */
  notFullyEvaluatedAreaCount: number;
  decision: DeploymentDecision;
};

export type PolicyInput = {
  status: VerdictStatus;
  confidence: "high" | "medium" | "low";
  unevaluatedAreaCount: number;
  partiallyEvaluatedAreaCount: number;
  /** The engine-derived decision after deferral / failed-review downgrade. */
  baseDecision: DeploymentDecision;
  freshnessStatus: "current" | "stale" | "unknown";
  reviewInProgress: boolean;
  reviewFailed: boolean;
};

export function deriveDecisionLanguagePolicy(input: PolicyInput): DecisionLanguagePolicy {
  const notFullyEvaluated = input.unevaluatedAreaCount + input.partiallyEvaluatedAreaCount;
  const base = {
    notFullyEvaluatedAreaCount: notFullyEvaluated,
    canUseSafeToDeployLanguage: false,
    canUseFirstPersonDeploymentLanguage: false,
    canUseVerifiedLanguage: false,
    mayRecommendDeploy: false,
  };

  if (input.baseDecision === "do_not_deploy") {
    return { ...base, strength: "BLOCKED", decision: "do_not_deploy" };
  }
  if (input.baseDecision === "more_analysis_required" || input.status !== "ready_to_ship") {
    return { ...base, strength: "INSUFFICIENT", decision: "more_analysis_required" };
  }
  if (input.reviewInProgress || input.reviewFailed || input.freshnessStatus !== "current") {
    return { ...base, strength: "INSUFFICIENT", decision: "more_analysis_required" };
  }
  if (input.confidence === "low") {
    return { ...base, strength: "QUALIFIED", decision: "more_analysis_required" };
  }
  if (input.confidence === "high" && notFullyEvaluated === 0) {
    return {
      ...base,
      strength: "HIGH_CONFIDENCE",
      mayRecommendDeploy: true,
      canUseSafeToDeployLanguage: true,
      canUseFirstPersonDeploymentLanguage: true,
      decision: "deploy",
    };
  }
  return { ...base, strength: "SUPPORTED", mayRecommendDeploy: true, decision: "deploy" };
}

/** Area-aware coverage that can never read as complete while areas remain. */
export function describeCoverage(
  verdict: Pick<
    ProductionVerdictV1,
    "coverageRatio" | "evaluatedAreas" | "partiallyEvaluatedAreas" | "unevaluatedAreas"
  >
): {
  ratio: number | null;
  fileCoverageRatio: number | null;
  evaluatedAreas: number;
  partiallyEvaluatedAreas: number;
  unevaluatedAreas: number;
  complete: boolean;
} {
  const evaluated = verdict.evaluatedAreas.length;
  const partial = verdict.partiallyEvaluatedAreas.length;
  const unevaluated = verdict.unevaluatedAreas.length;
  const total = evaluated + partial + unevaluated;
  const complete = partial === 0 && unevaluated === 0 && verdict.coverageRatio === 1;
  const areaRatio = total > 0 ? evaluated / total : null;
  let ratio = verdict.coverageRatio;
  if (partial + unevaluated > 0 && areaRatio != null) {
    ratio = ratio == null ? areaRatio : Math.min(ratio, areaRatio);
  }
  return {
    ratio,
    fileCoverageRatio: verdict.coverageRatio,
    evaluatedAreas: evaluated,
    partiallyEvaluatedAreas: partial,
    unevaluatedAreas: unevaluated,
    complete,
  };
}

const APPROVAL_PATTERNS: RegExp[] = [
  /safe\s+(?:to|for)\s+(?:deploy|ship|production|release)/i,
  /security\s+decision:\s*(?:safe|deploy\b)/i,
  /\b(?:i|we)(?:'d|\s+would|'ll|\s+will)\s+(?:deploy|ship|release)\b/i,
  /\bwould\s+(?:deploy|ship)\s+(?:this|it)\b/i,
  /(?<!\b(?:not|n't)\s+(?:fully\s+)?)comfortable\s+(?:with\s+you\s+)?(?:shipping|deploying|protecting)/i,
  /deploy\s+with\s+confidence/i,
  /\b(?:fully|completely)\s+(?:secure|analy[sz]ed|verified)\b/i,
  /\bproven\s+(?:secure|safe)\b/i,
  /(?<!\bno\s+)me\s+siento\s+(?:del\s+todo\s+)?c[oó]modo/i,
  /desplegar[ií]a\s+esto/i,
  /(?:enviar[ií]a|lanzar[ií]a)\s+esto/i,
  /(?:es\s+)?seguro\s+(?:para\s+)?(?:desplegar|producci[oó]n)/i,
  /puedes\s+desplegar/i,
  /despliega\s+cuando\s+est[eé]s\s+listo/i,
  /ship\s+when\s+you'?re\s+ready/i,
  /\bship\s+it\b/i,
  /desplegar\s+con\s+confianza/i,
];

export function containsApprovalLanguage(text: string): boolean {
  return APPROVAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Backstop for free text that originates outside the deterministic layer
 * (persisted executive summaries, AI/security-decision narratives, alerts).
 * When the policy forbids approval language and the text contains it, the
 * text is dropped in favour of the caller's deterministic fallback.
 */
export function guardDecisionText(
  text: string,
  policy: DecisionLanguagePolicy,
  fallback = ""
): string {
  if (policy.strength === "HIGH_CONFIDENCE") return text;
  return containsApprovalLanguage(text) ? fallback : text;
}
