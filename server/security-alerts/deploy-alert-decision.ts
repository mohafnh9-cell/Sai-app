/**
 * Derives the founder-facing "deploy check" alert from the canonical decision
 * (the same state can_i_deploy / safe_fix / what_changed / production_history
 * answer from). Alerts used to hardcode "Apply Safe Fix before you ship" for
 * every non-go answer, so an alert could tell a founder to fix something while
 * safe_fix correctly reported there was no verified finding to fix.
 *
 * Authority: this module owns no readiness logic of its own. It only maps the
 * already-decided canonical outcome to an appropriate action, and Safe Fix is
 * only ever offered when there is a concrete actionable finding.
 */

export type DeployAlertAction =
  | "safe_fix"
  | "analyze"
  | "retry"
  | "wait"
  | "rescan"
  | "review_failed";

export type DeployAlertDecisionInput = {
  deploymentRecommendation: "SHIP_IT" | "DO_NOT_DEPLOY" | "MORE_ANALYSIS_REQUIRED";
  verdictStatus: string;
  reviewInProgress: boolean;
  reviewFailed: boolean;
  freshnessStatus: "current" | "stale" | "unknown";
  /** A concrete top priority exists to generate a Safe Fix for. */
  hasActionableFinding: boolean;
  /** Scan the authoritative verdict was generated from. */
  verdictScanId: string | null;
  primaryWorry: string | null;
};

export type DeployAlertDecision = {
  action: DeployAlertAction;
  ctaType: "safe_fix" | "review_again";
  nextAction: string;
  changedBullets: string[];
  protectionImpact: string;
  /** Omitted for safe_fix so the severity's default founder line applies. */
  worryLine?: string;
  dedupeKey: string;
  decisionScanId: string | null;
};

const ALERT_KIND = "deploy_blocked";

/** `${projectId}:deploy_blocked:${scanId}:${action}` -- binds an alert to the decision it describes. */
export function buildDeployAlertDedupeKey(input: {
  projectId: string;
  scanId: string | null;
  action: DeployAlertAction;
}): string {
  return `${input.projectId}:${ALERT_KIND}:${input.scanId ?? "none"}:${input.action}`;
}

/**
 * The scan a deploy alert was computed for, or null for an alert that is not
 * bound to any scan (legacy day-keyed alerts, or any non-deploy alert kind).
 */
export function decisionScanIdFromDedupeKey(dedupeKey: string | null | undefined): string | null {
  if (!dedupeKey) return null;
  const parts = dedupeKey.split(":");
  if (parts.length !== 4 || parts[1] !== ALERT_KIND) return null;
  return parts[2] === "none" ? null : parts[2];
}

export function isDecisionBoundAlertKind(alertKind: string): boolean {
  return alertKind === ALERT_KIND;
}

/** Returns null when the canonical decision is a current, clean "ship" (nothing to warn about). */
export function deriveDeployAlertDecision(
  projectId: string,
  input: DeployAlertDecisionInput
): DeployAlertDecision | null {
  const cleanAndCurrent =
    input.deploymentRecommendation === "SHIP_IT" &&
    !input.reviewInProgress &&
    !input.reviewFailed &&
    input.freshnessStatus !== "stale";
  if (cleanAndCurrent) return null;

  let action: DeployAlertAction;
  if (input.reviewInProgress) action = "wait";
  else if (input.reviewFailed) action = "review_failed";
  else if (input.freshnessStatus === "stale") action = "rescan";
  else if (input.verdictStatus === "analysis_failed") action = "retry";
  else if (input.hasActionableFinding) action = "safe_fix";
  else action = "analyze";

  const worry = input.primaryWorry?.trim() || null;
  const NOT_CONFIRMED_WORRY = "Nothing is confirmed wrong — SequrAI just cannot give a deploy answer yet.";
  const byAction: Record<DeployAlertAction, Omit<DeployAlertDecision, "dedupeKey" | "decisionScanId" | "action">> = {
    safe_fix: {
      ctaType: "safe_fix",
      nextAction: "Apply Safe Fix before you ship.",
      changedBullets: [worry ?? "SequrAI is not comfortable with a deploy right now."],
      protectionImpact: "Worth fixing before your next deploy.",
    },
    analyze: {
      worryLine: NOT_CONFIRMED_WORRY,
      ctaType: "review_again",
      nextAction: 'Say "Review my project" so SequrAI can complete the analysis before you ship.',
      changedBullets: ["SequrAI needs more analysis before it can answer whether to deploy."],
      protectionImpact: "There is no verified finding to fix yet — the review is not complete enough.",
    },
    retry: {
      worryLine: NOT_CONFIRMED_WORRY,
      ctaType: "review_again",
      nextAction: 'Say "Review again" — the last review did not complete.',
      changedBullets: ["The last review did not complete, so SequrAI cannot answer yet."],
      protectionImpact: "Do not rely on the previous answer until a review completes.",
    },
    wait: {
      worryLine: NOT_CONFIRMED_WORRY,
      ctaType: "review_again",
      nextAction: 'Wait for the current review to finish, then ask "Can I deploy?"',
      changedBullets: ["A review is running, so the previous answer is no longer representative."],
      protectionImpact: "The answer will update when the review finishes.",
    },
    rescan: {
      worryLine: NOT_CONFIRMED_WORRY,
      ctaType: "review_again",
      nextAction: 'Say "Review again" so SequrAI covers your latest commit.',
      changedBullets: ["Your latest commit has not been reviewed yet."],
      protectionImpact: "The current answer may not cover your latest code.",
    },
    review_failed: {
      worryLine: NOT_CONFIRMED_WORRY,
      ctaType: "review_again",
      nextAction: 'Say "Review again" — your latest review did not finish.',
      changedBullets: ["Your latest review did not finish."],
      protectionImpact: "The current answer may not cover your newest commit.",
    },
  };

  return {
    action,
    ...byAction[action],
    dedupeKey: buildDeployAlertDedupeKey({
      projectId,
      scanId: input.verdictScanId,
      action,
    }),
    decisionScanId: input.verdictScanId,
  };
}

/**
 * Deploy alerts describe one specific decision. Once the authoritative
 * verdict moves to a different scan -- or the alert was never bound to a scan
 * -- it is history and must not be presented as the current decision.
 */
export function isHistoricalAlert(
  alert: { alertKind: string; decisionScanId?: string | null },
  currentScanId: string | null
): boolean {
  if (!isDecisionBoundAlertKind(alert.alertKind)) return false;
  // Without a known current decision an alert cannot be shown to describe it:
  // fail closed to historical rather than presenting it as current.
  if (!currentScanId) return true;
  return (alert.decisionScanId ?? null) !== currentScanId;
}
