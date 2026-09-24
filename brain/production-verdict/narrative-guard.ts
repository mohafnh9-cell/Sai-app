/**
 * Pure (no server/LLM) guard for verdict narrative text.
 *
 * INVARIANT: no persisted or displayed narrative (AI / security-decision
 * headline, recommended action) may carry deployment-approval language the
 * evidence does not support. Approval wording is allowed only for a
 * ready_to_ship verdict with high confidence and every area evaluated.
 */
export const APPROVAL_PATTERNS: RegExp[] = [
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

export const NEUTRAL_EXECUTIVE_SUMMARY =
  "Production review completed. The deployment answer states what the current evidence supports.";
export const NEUTRAL_RECOMMENDED_ACTION = "Review the Production Verdict details.";

/** Evidence-only condition under which approval wording is permitted in stored narratives. */
export function narrativeMayApprove(v: {
  status: unknown;
  confidence: unknown;
  partiallyEvaluatedAreas: unknown[];
  unevaluatedAreas: unknown[];
}): boolean {
  return (
    v.status === "ready_to_ship" &&
    v.confidence === "high" &&
    v.partiallyEvaluatedAreas.length === 0 &&
    v.unevaluatedAreas.length === 0
  );
}

/** Replaces approval text the evidence does not support. Returns a new object. */
export function applyNarrativeGuard<
  T extends {
    status: unknown;
    confidence: unknown;
    partiallyEvaluatedAreas: unknown[];
    unevaluatedAreas: unknown[];
    executiveSummary: string;
    recommendedAction: string;
  },
>(verdict: T): T {
  if (narrativeMayApprove(verdict)) return verdict;
  return {
    ...verdict,
    executiveSummary: containsApprovalLanguage(verdict.executiveSummary)
      ? NEUTRAL_EXECUTIVE_SUMMARY
      : verdict.executiveSummary,
    recommendedAction: containsApprovalLanguage(verdict.recommendedAction)
      ? NEUTRAL_RECOMMENDED_ACTION
      : verdict.recommendedAction,
  };
}

/**
 * For narratives that bypass the verdict record (e.g. the raw AI report shown
 * beside a verdict): returns `text` only if it is safe for the given evidence,
 * otherwise `fallback`.
 */
export function guardNarrativeForVerdict(
  text: string | null | undefined,
  verdict: Parameters<typeof narrativeMayApprove>[0] | null,
  fallback: string | null
): string | null {
  if (!text) return fallback;
  if (verdict && narrativeMayApprove(verdict)) return text;
  return containsApprovalLanguage(text) ? fallback : text;
}
