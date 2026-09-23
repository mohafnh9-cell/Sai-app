import "server-only";

import { isValidJourneyVerdict } from "@/brain/production-journey";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { loadVerdictJourneyRecords } from "@/server/production-journey/load-verdicts";
import type { McpAuthContext } from "../auth";
import { McpError } from "../auth";
import type { McpTranslator } from "../i18n";
import type { ProjectSelector } from "../project-resolution";
import { resolveMcpProject } from "../project-resolution";
import { formatWhatChangedResponse, pickRecommendedAction } from "../personality";
import { resolveCanonicalDecisionState } from "../canonical-decision-state";
import type { DeploymentDecision } from "../decision-mapping";
import type { FreshnessStatus } from "../staleness";

export type WhatChangedInput = ProjectSelector;

export type WhatChangedResult = {
  mode: "continuous_review";
  source: "github";
  project: { id: string; name: string; repositoryFullName: string | null };
  currentScore: number | null;
  previousScore: number | null;
  scoreDelta: number | null;
  currentVerdict: VerdictStatus;
  previousVerdict: VerdictStatus | null;
  resolvedBlockers: string[];
  detectedBlockers: string[];
  confirmedIntroducedBlockers: string[];
  improvements: string[];
  regressions: string[];
  nextAction: string;
  /**
   * AUTHORITATIVE current decision, identical in semantics to can_i_deploy.
   * currentVerdict/currentScore above describe the compared review and are
   * HISTORICAL unless comparisonReflectsCurrentVerdict is true.
   */
  currentDecision: DeploymentDecision;
  authoritativeVerdictStatus: VerdictStatus;
  reviewInProgress: boolean;
  freshnessStatus: FreshnessStatus;
  comparisonReflectsCurrentVerdict: boolean;
  currentCommitSha: string | null;
  previousCommitSha: string | null;
  reviewedAt: string;
  summary: string;
};

/**
 * "What changed since my previous valid Production Review?" — retrieves the
 * two most recent valid, already-persisted verdicts and compares them.
 * ADR-001: no new score/status/blocker calculation happens here.
 *
 * Trust rule: there is currently no repository-diff-evidence system wired to
 * MCP, so this handler never claims a new blocker was "introduced by your
 * latest change" (confirmedIntroducedBlockers is always empty). New
 * blockers are reported as "detected in the latest review" only.
 */
export async function whatChanged(
  ctx: McpAuthContext,
  input: WhatChangedInput,
  t: McpTranslator
): Promise<WhatChangedResult> {
  const project = await resolveMcpProject(ctx, input, t);

  const { records } = await loadVerdictJourneyRecords(ctx.admin, project.id, { limit: 200 });
  const valid = records
    .filter((r) => isValidJourneyVerdict(r.status, r.score))
    .sort((a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime());

  if (valid.length === 0) {
    throw new McpError(404, "no_verdict_available", t("errors.no_verdict_available"));
  }

  const current = valid[valid.length - 1];
  const previous = valid.length > 1 ? valid[valid.length - 2] : null;

  // The decision-facing state comes from the single canonical authority
  // (same one can_i_deploy uses) -- never hardcoded "not running / current /
  // not failed" defaults, which previously let this tool tell an agent to
  // ship while a newer review was running or the verdict was stale.
  const state = await resolveCanonicalDecisionState(ctx, project.id);
  const decision: DeploymentDecision = state?.decision ?? "more_analysis_required";
  const authoritativeStatus: VerdictStatus = state?.verdict.status ?? current.status;
  const stalenessFootnotes = state?.stalenessFootnotes ?? {
    reviewInProgress: false,
    freshnessStatus: "unknown" as const,
    reviewFailed: false,
    latestDetectedCommitSha: null,
  };
  const comparisonReflectsCurrentVerdict =
    state != null && current.verdict.scanId === state.verdict.scanId;

  const scoreDelta =
    current.score != null && previous?.score != null ? current.score - previous.score : null;

  const previousPriorityIds = new Set((previous?.verdict.topPriorities ?? []).map((p) => p.id));
  const currentPriorityIds = new Set(current.verdict.topPriorities.map((p) => p.id));

  // A priority missing from the latest review is only "no longer detected"
  // if that review actually had enough evidence to see it. An insufficient
  // or failed evaluation (partial engines, low coverage) proves nothing
  // about findings it could not evaluate, so nothing is reported as resolved.
  const currentEvidenceIsComplete =
    current.status !== "insufficient_data" && current.status !== "analysis_failed";
  const resolvedBlockers = currentEvidenceIsComplete
    ? (previous?.verdict.topPriorities ?? [])
        .filter((p) => !currentPriorityIds.has(p.id))
        .map((p) => p.title)
    : [];

  const detectedBlockers = current.verdict.topPriorities
    .filter((p) => !previousPriorityIds.has(p.id))
    .map((p) => p.title);

  const confirmedIntroducedBlockers: string[] = [];

  const improvements = [...resolvedBlockers];
  if (scoreDelta != null && scoreDelta > 0) {
    improvements.push(`+${scoreDelta} pts`);
  }

  const regressions = [...detectedBlockers];
  if (scoreDelta != null && scoreDelta < 0) {
    regressions.push(`${scoreDelta} pts`);
  }

  const recommendedAction = pickRecommendedAction(t, {
    decision,
    status: authoritativeStatus,
    blockersCount: state?.verdict.blockersCount ?? current.verdict.blockersCount,
    staleness: stalenessFootnotes,
  });

  const summary = formatWhatChangedResponse(t, {
    hasPrevious: Boolean(previous),
    comparisonAvailable: comparisonReflectsCurrentVerdict,
    scoreDelta,
    resolved: resolvedBlockers,
    detected: detectedBlockers,
    recommendedAction,
    currentState: { decision, staleness: stalenessFootnotes },
  });

  return {
    mode: "continuous_review",
    source: "github",
    project,
    currentScore: current.score,
    previousScore: previous?.score ?? null,
    scoreDelta,
    currentVerdict: current.status,
    previousVerdict: previous?.status ?? null,
    resolvedBlockers,
    detectedBlockers,
    confirmedIntroducedBlockers,
    improvements,
    regressions,
    nextAction: recommendedAction,
    currentDecision: decision,
    authoritativeVerdictStatus: authoritativeStatus,
    reviewInProgress: stalenessFootnotes.reviewInProgress,
    freshnessStatus: stalenessFootnotes.freshnessStatus,
    comparisonReflectsCurrentVerdict,
    currentCommitSha: current.commitSha,
    previousCommitSha: previous?.commitSha ?? null,
    reviewedAt: current.generatedAt,
    summary,
  };
}
