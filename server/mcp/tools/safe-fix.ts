import "server-only";

import {
  buildProductionFixPrompt,
  fixPromptInputFromFinding,
  fixPromptInputFromPriority,
  formatEstimatedFixTime,
  projectedScoreAfterFix,
  projectedVerdictStatusAfterFix,
  stackFromDetectedStack,
} from "@/brain/fix-prompt";
import type { ProductionPriority } from "@/brain/production-verdict/schema";
import type { McpAuthContext } from "../auth";
import { McpError } from "../auth";
import { resolveCanonicalDecisionState } from "../canonical-decision-state";
import type { McpTranslator } from "../i18n";
import type { ProjectSelector } from "../project-resolution";
import { resolveMcpProject } from "../project-resolution";
import {
  formatSafeFixChooseBlockers,
  formatSafeFixNoActionableFinding,
  formatSafeFixNoBlockers,
  formatSafeFixPromptReady,
  type SafeFixNoActionableReason,
} from "../personality";
import { assertFixPromptOutputSafe } from "@/server/mcp/security";

export type SafeFixInput = ProjectSelector & {
  blockerId?: string;
  priorityId?: string;
  findingId?: string;
};

export type SafeFixBlockerSummary = {
  id: string;
  title: string;
  severity: string;
  category: string;
};

export type SafeFixResult =
  | {
      mode: "safe_fix";
      source: "github";
      status: "choose_blocker";
      project: { id: string; name: string; repositoryFullName: string | null };
      blockers: SafeFixBlockerSummary[];
      summary: string;
    }
  | {
      mode: "safe_fix";
      source: "github";
      status: "no_blockers";
      project: { id: string; name: string; repositoryFullName: string | null };
      summary: string;
    }
  | {
      mode: "safe_fix";
      source: "github";
      /**
       * There is no concrete finding to generate a fix for, but that does NOT
       * mean the project is clean: the evidence is incomplete, stale, being
       * replaced by a running review, or otherwise not a "ready" verdict.
       */
      status: "no_actionable_finding";
      reason: SafeFixNoActionableReason;
      verdictStatus: string;
      project: { id: string; name: string; repositoryFullName: string | null };
      summary: string;
    }
  | {
      mode: "safe_fix";
      source: "github";
      status: "prompt_ready";
      project: { id: string; name: string; repositoryFullName: string | null };
      blocker: {
        id: string;
        title: string;
        severity: string;
        category: string;
        evidence: string[];
      };
      safeFixPrompt: string;
      safeFixConfidence: number;
      implementationRisk: "LOW" | "MEDIUM" | "HIGH";
      estimatedFixTime: string;
      estimatedFilesChanged: number;
      estimatedScope: string;
      projectedScore: number;
      projectedVerdict: string;
      generatedAt: string;
      summary: string;
    };

const MAX_BLOCKER_CANDIDATES = 5;

type RawFindingRow = {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  category: string;
  file_path: string | null;
  start_line: number | null;
  recommendation: string | null;
  impact: string | null;
  scan_id: string;
};

/**
 * "How do I safely fix this blocker?" — delegates entirely to the existing
 * Production Safe Fix Engine (brain/fix-prompt). This handler never invents
 * its own confidence, risk, or scoring model; it only retrieves the
 * canonical blocker, calls the engine, and formats the result (ADR-001).
 */
export async function safeFix(
  ctx: McpAuthContext,
  input: SafeFixInput,
  t: McpTranslator
): Promise<SafeFixResult> {
  const project = await resolveMcpProject(ctx, input, t);

  const state = await resolveCanonicalDecisionState(ctx, project.id);
  if (!state) {
    throw new McpError(404, "no_verdict_available", t("errors.no_verdict_available"));
  }
  const verdict = state.verdict;

  if (verdict.blockersCount === 0 && verdict.topPriorities.length === 0) {
    // "Nothing to fix" is only a truthful thing to say when the decision
    // authority says the project is genuinely clean and current. Zero
    // findings from an insufficient, stale, failed, or in-flight review is
    // absence of evidence, not evidence of absence.
    if (state.isCleanAndCurrent) {
      return {
        mode: "safe_fix",
        source: "github" as const,
        status: "no_blockers",
        project,
        summary: formatSafeFixNoBlockers(t),
      };
    }

    const reason: SafeFixNoActionableReason = state.reviewInProgress
      ? "review_in_progress"
      : state.reviewFailed
        ? "review_failed"
        : verdict.status === "insufficient_data" || verdict.status === "analysis_failed"
          ? "insufficient_evidence"
          : state.staleness.freshnessStatus !== "current"
            ? "stale_or_unverified"
            : "not_ready_without_specific_finding";

    return {
      mode: "safe_fix",
      source: "github" as const,
      status: "no_actionable_finding",
      reason,
      verdictStatus: verdict.status,
      project,
      summary: formatSafeFixNoActionableFinding(t, reason),
    };
  }

  const requestedId = input.blockerId?.trim() || input.priorityId?.trim() || input.findingId?.trim();

  const { data: extraFindings } = await ctx.admin
    .from("scan_findings")
    .select(
      "id, title, description, severity, category, file_path, start_line, recommendation, impact, scan_id"
    )
    .eq("scan_id", verdict.scanId)
    .in("severity", ["critical", "high"])
    .order("severity", { ascending: true })
    .limit(MAX_BLOCKER_CANDIDATES + verdict.topPriorities.length);

  const coveredFindingIds = new Set(verdict.topPriorities.flatMap((p) => p.findingIds));
  const additionalFindings: RawFindingRow[] = (extraFindings ?? [])
    .filter((f) => !coveredFindingIds.has(f.id))
    .slice(0, Math.max(0, MAX_BLOCKER_CANDIDATES - verdict.topPriorities.length));

  if (!requestedId) {
    const blockers: SafeFixBlockerSummary[] = [
      ...verdict.topPriorities.map((p) => ({
        id: p.id,
        title: p.title,
        severity: p.severity,
        category: p.category,
      })),
      ...additionalFindings.map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        category: f.category,
      })),
    ].slice(0, MAX_BLOCKER_CANDIDATES);

    return {
      mode: "safe_fix",
      source: "github" as const,
      status: "choose_blocker",
      project,
      blockers,
      summary: formatSafeFixChooseBlockers(t, blockers),
    };
  }

  const matchedPriority: ProductionPriority | undefined = verdict.topPriorities.find(
    (p) => p.id === requestedId || p.findingIds.includes(requestedId)
  );

  let promptInput;
  let evidence: string[] = [];
  let blockerSummary: SafeFixBlockerSummary;

  if (matchedPriority) {
    const { data: scan } = await ctx.admin
      .from("scans")
      .select("detected_stack")
      .eq("id", verdict.scanId)
      .maybeSingle();

    promptInput = fixPromptInputFromPriority(matchedPriority, {
      projectName: project.name,
      stack: stackFromDetectedStack(scan?.detected_stack),
      currentVerdictStatus: verdict.status,
      currentScore: verdict.score,
    });
    evidence = matchedPriority.affectedFiles;
    blockerSummary = {
      id: matchedPriority.id,
      title: matchedPriority.title,
      severity: matchedPriority.severity,
      category: matchedPriority.category,
    };
  } else {
    const matchedFinding = additionalFindings.find((f) => f.id === requestedId);
    if (!matchedFinding) {
      throw new McpError(404, "blocker_not_found", t("errors.blocker_not_found"));
    }

    const { data: scan } = await ctx.admin
      .from("scans")
      .select("detected_stack")
      .eq("id", matchedFinding.scan_id)
      .maybeSingle();

    promptInput = fixPromptInputFromFinding(
      {
        id: matchedFinding.id,
        title: matchedFinding.title,
        description: matchedFinding.description ?? undefined,
        severity: matchedFinding.severity,
        category: matchedFinding.category,
        recommendation: matchedFinding.recommendation ?? undefined,
        file_path: matchedFinding.file_path ?? undefined,
        start_line: matchedFinding.start_line ?? undefined,
        impact: matchedFinding.impact ?? undefined,
      },
      {
        projectName: project.name,
        stack: stackFromDetectedStack(scan?.detected_stack),
        currentVerdictStatus: verdict.status,
        currentScore: verdict.score,
      }
    );
    evidence = matchedFinding.file_path
      ? [`${matchedFinding.file_path}${matchedFinding.start_line ? `:${matchedFinding.start_line}` : ""}`]
      : [];
    blockerSummary = {
      id: matchedFinding.id,
      title: matchedFinding.title,
      severity: matchedFinding.severity,
      category: matchedFinding.category,
    };
  }

  let fixResult;
  try {
    fixResult = buildProductionFixPrompt(promptInput);
  } catch {
    throw new McpError(422, "safe_fix_unavailable", t("errors.safe_fix_unavailable"));
  }

  const projectedScore = projectedScoreAfterFix(promptInput);
  const projectedStatus = projectedVerdictStatusAfterFix(promptInput);
  const estimatedFixTime = formatEstimatedFixTime(promptInput.estimatedFixMinutes);

  return {
    mode: "safe_fix",
    source: "github" as const,
    status: "prompt_ready",
    project,
    blocker: { ...blockerSummary, evidence },
    safeFixPrompt: assertFixPromptOutputSafe(fixResult.prompt),
    safeFixConfidence: fixResult.assessment.safeFixConfidence,
    implementationRisk: fixResult.assessment.implementationRisk,
    estimatedFixTime,
    estimatedFilesChanged: fixResult.assessment.estimatedScope.filesExpected,
    estimatedScope: fixResult.assessment.estimatedScope.complexityLabel,
    projectedScore,
    projectedVerdict: projectedStatus,
    generatedAt: new Date().toISOString(),
    summary: formatSafeFixPromptReady(t, {
      title: blockerSummary.title,
      estimatedFixTime,
      prompt: fixResult.prompt,
    }),
  };
}
