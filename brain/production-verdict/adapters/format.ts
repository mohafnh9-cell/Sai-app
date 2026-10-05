import type { ProductionVerdictV1 } from "../schema";
import { VERDICT_STATUS_LABELS } from "../schema";
import { narrativeMayApprove } from "../narrative-guard";

export function githubVerdictLabel(
  status: ProductionVerdictV1["status"],
  evidence?: Pick<ProductionVerdictV1, "confidence" | "unevaluatedAreas" | "partiallyEvaluatedAreas">
): string {
  switch (status) {
    case "ready_to_ship":
      // Approval-strength wording only when the evidence supports it.
      if (evidence && !narrativeMayApprove({ status, ...evidence })) {
        return "SequrAI — No blockers found (evidence limited)";
      }
      return "SequrAI — Ready to Ship";
    case "almost_ready":
      return "SequrAI — Review Recommended";
    case "insufficient_data":
      return "SequrAI — More Analysis Required";
    case "analysis_failed":
      return "SequrAI — Analysis Failed";
    default:
      return "SequrAI — Not Ready";
  }
}

export function formatGithubCheckDescription(verdict: ProductionVerdictV1): string {
  const parts = [
    githubVerdictLabel(verdict.status, verdict),
    verdict.score != null ? `${verdict.score}/100` : undefined,
    `${verdict.blockersCount} blockers`,
  ].filter(Boolean);

  if (verdict.scoreDelta != null && verdict.scoreDelta !== 0) {
    const sign = verdict.scoreDelta > 0 ? "+" : "";
    parts.push(`${sign}${verdict.scoreDelta} pts`);
  }
  if (verdict.resolvedBlockers > 0) parts.push(`${verdict.resolvedBlockers} resolved`);
  if (verdict.introducedBlockers > 0) parts.push(`${verdict.introducedBlockers} new`);

  return parts.join(" · ").slice(0, 140);
}

export function formatGithubCheckSummary(input: {
  verdict: ProductionVerdictV1;
  reportUrl?: string;
}): string {
  const { verdict } = input;
  const lines = [
    githubVerdictLabel(verdict.status, verdict),
    verdict.score != null
      ? `Production Ready Score: ${verdict.score}/100`
      : "Production Ready Score unavailable",
  ];

  if (verdict.scoreDelta != null && verdict.scoreDelta !== 0) {
    const sign = verdict.scoreDelta > 0 ? "+" : "";
    lines.push(`Change: ${sign}${verdict.scoreDelta}`);
  }
  if (verdict.introducedBlockers > 0) lines.push(`New blockers: ${verdict.introducedBlockers}`);
  if (verdict.resolvedBlockers > 0) lines.push(`Resolved blockers: ${verdict.resolvedBlockers}`);

  if (verdict.topPriorities.length > 0) {
    lines.push("Fastest path forward:");
    for (const priority of verdict.topPriorities) {
      lines.push(`${priority.rank}. ${priority.title} — ${priority.estimatedTimeLabel}`);
    }
  }

  lines.push("View Production Verdict");
  if (input.reportUrl) lines.push(input.reportUrl);

  return lines.join("\n");
}

export function formatMcpVerdictSummary(verdict: ProductionVerdictV1): string {
  // ready_to_ship without the evidence to approve it is never presented as "READY TO SHIP".
  const limitedReady = verdict.status === "ready_to_ship" && !narrativeMayApprove(verdict);
  const lines = [
    limitedReady ? "NO BLOCKERS FOUND (EVIDENCE LIMITED)" : VERDICT_STATUS_LABELS[verdict.status].toUpperCase(),
    verdict.score != null
      ? `${verdict.score} / 100 Production Ready Score`
      : "Production Ready Score unavailable",
    verdict.blockersCount > 0
      ? `${verdict.blockersCount} production blocker${verdict.blockersCount === 1 ? "" : "s"}.`
      : "No production blockers detected.",
  ];

  if (verdict.topPriorities.length > 0) {
    lines.push("Fastest path forward:");
    for (const priority of verdict.topPriorities) {
      lines.push(
        `${priority.rank}. ${priority.title} — ${priority.estimatedTimeLabel} — +${priority.projectedScoreImpact} pts`
      );
    }
  }

  if (verdict.projectedScore != null) {
    lines.push(`Projected score (estimate): ${verdict.projectedScore}`);
  }
  if (verdict.estimatedFixMinutes > 0) {
    lines.push(`Estimated total time: ${verdict.estimatedFixMinutes} min`);
  }
  lines.push(`Recommended action: ${verdict.recommendedAction}`);
  return lines.join("\n");
}
