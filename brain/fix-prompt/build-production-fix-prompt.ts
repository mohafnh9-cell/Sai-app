import {
  VERDICT_STATUS_LABELS,
  type ProductionPriority,
  type VerdictStatus,
} from "@/brain/production-verdict/schema";
import type { ScanFinding } from "@/features/security-scanner/components/types";
import { findingFile } from "@/features/security-scanner/components/types";
import { assessSafeFix, formatEstimatedFixTime } from "./assessment";
import { guidanceForCategory } from "./category-guidance";
import { formatStackLines } from "./format-stack";
import type { FixPromptStack, ProductionFixPromptInput, ProductionFixPromptResult } from "./types";
import {
  assertFixPromptOutputSafe,
  sanitizeProductionFixPromptInput,
} from "@/server/mcp/security";

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function section(title: string, body: string): string {
  return `${title}\n\n${body}`;
}

function severityImpact(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "Critical — blocks safe production deployment until resolved.";
    case "high":
      return "High — prevents shipping until this production blocker is fixed.";
    case "medium":
      return "Medium — improves production readiness but does not block deployment.";
    default:
      return "Low — incremental improvement to production readiness.";
  }
}

const SAFE_IMPLEMENTATION_PRINCIPLES = [
  "Make the smallest possible safe change that fully resolves this blocker.",
  "Do not introduce breaking changes to existing behaviour.",
  "Preserve the user's project intent, architecture, and UX.",
  "Prefer additive or narrowly scoped edits over refactors.",
  "Stop once the blocker is resolved — do not improve unrelated code.",
];

/**
 * Single formula for "current score + this fix's projected impact", reused
 * by every consumer (web, MCP) so no caller invents its own arithmetic.
 * Both inputs are already canonical Production Verdict Engine output.
 */
export function projectedScoreAfterFix(input: ProductionFixPromptInput): number {
  const raw = (input.currentScore ?? 0) + (input.projectedScoreImpact ?? 0);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function projectedVerdictStatusAfterFix(input: ProductionFixPromptInput): VerdictStatus {
  const current = input.currentVerdictStatus ?? "not_ready";
  const projectedScore = projectedScoreAfterFix(input);

  if (projectedScore >= 85 && current !== "ready_to_ship") {
    return "ready_to_ship";
  }
  if (projectedScore >= 70) {
    return "almost_ready";
  }
  if (projectedScore >= 55) {
    return "needs_improvement";
  }
  if (current === "insufficient_data" || current === "analysis_failed") {
    return current;
  }
  return "not_ready";
}

export function projectedVerdictAfterFix(input: ProductionFixPromptInput): string {
  return VERDICT_STATUS_LABELS[projectedVerdictStatusAfterFix(input)];
}

export function buildProductionFixPrompt(
  input: ProductionFixPromptInput
): ProductionFixPromptResult {
  const guardedInput = sanitizeProductionFixPromptInput(input);
  const guidance = guidanceForCategory(guardedInput.category);
  const buildCommands = guardedInput.buildCommands ?? guidance.buildRequirements;
  const projectedVerdictLabel = projectedVerdictAfterFix(guardedInput);
  const currentVerdictLabel = guardedInput.currentVerdictStatus
    ? VERDICT_STATUS_LABELS[guardedInput.currentVerdictStatus]
    : "Not Ready to Ship";
  const assessment = assessSafeFix(guardedInput);

  const files =
    guardedInput.affectedFiles.length > 0
      ? bulletList(guardedInput.affectedFiles)
      : "- Review the codebase area related to this issue during implementation.";

  const stackLines = formatStackLines(guardedInput.stack).join("\n");
  const severityLabel = guardedInput.severity.charAt(0).toUpperCase() + guardedInput.severity.slice(1);

  const promptBody = [
    section(
      "PROJECT CONTEXT",
      [
        guardedInput.projectName ? `Project: ${guardedInput.projectName}` : null,
        "Detected stack:",
        stackLines,
      ]
        .filter(Boolean)
        .join("\n")
    ),
    section(
      "PRODUCTION BLOCKER",
      [
        `Title: ${guardedInput.issueTitle}`,
        `Severity: ${severityLabel}`,
        guardedInput.affectedFiles[0] ? `Location: ${guardedInput.affectedFiles[0]}` : null,
        "",
        guardedInput.issueDescription,
        "",
        `Estimated impact: ${guardedInput.estimatedImpact ?? severityImpact(guardedInput.severity)}`,
      ]
        .filter(Boolean)
        .join("\n")
    ),
    section(
      "WHY THIS MATTERS",
      [
        guardedInput.whyItMatters,
        "",
        `Production risk: ${assessment.riskReason}`,
        `Implementation risk: ${assessment.implementationRisk}`,
      ].join("\n")
    ),
    section(
      "GOAL",
      [
        `Fix this ${guardedInput.category.replace(/_/g, " ")} production blocker with the smallest possible safe change.`,
        guardedInput.recommendedAction,
      ].join("\n")
    ),
    section("FILES TO REVIEW", files),
    section("PRESERVE THE FOLLOWING", bulletList(guidance.preserve)),
    section("DO NOT MODIFY", bulletList(guidance.doNotModify)),
    section("IMPLEMENTATION REQUIREMENTS", [
      "Apply the minimum required code changes using the safest possible approach.",
      "Match existing project conventions, naming, and file structure.",
      "",
      guardedInput.recommendedAction,
    ].join("\n")),
    section("SAFE IMPLEMENTATION PRINCIPLES", bulletList(SAFE_IMPLEMENTATION_PRINCIPLES)),
    section("REGRESSION TESTS", bulletList(guidance.regressionTests)),
    section(
      "BUILD REQUIREMENTS",
      [
        "Before finishing, run:",
        bulletList(buildCommands),
        "",
        "Confirm the fix does not introduce new TypeScript, lint, or test failures.",
      ].join("\n")
    ),
    section("CONFIDENCE SCORE", [
      `Safe Fix Confidence: ${assessment.safeFixConfidence}%`,
      "",
      "This score represents how confident SequrAI is that this change can be implemented safely without introducing regressions.",
    ].join("\n")),
    section("IMPLEMENTATION RISK", [
      assessment.implementationRisk,
      "",
      assessment.riskReason,
    ].join("\n")),
    section("ESTIMATED FIX TIME", formatEstimatedFixTime(guardedInput.estimatedFixMinutes)),
    section("ESTIMATED SCOPE", [
      `Files expected to change: ${assessment.estimatedScope.filesExpected}`,
      `Estimated LOC modifications: ${assessment.estimatedScope.estimatedLocMin}–${assessment.estimatedScope.estimatedLocMax}`,
      `Complexity: ${assessment.estimatedScope.complexityLabel}`,
    ].join("\n")),
    section(
      "PROJECTED PRODUCTION VERDICT",
      [
        "Current:",
        currentVerdictLabel,
        "",
        "Projected:",
        projectedVerdictLabel,
        guardedInput.projectedScoreImpact
          ? `(Estimated score improvement: +${guardedInput.projectedScoreImpact} points)`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    ),
  ].join("\n\n------------------------------------------------------------\n\n");

  const prompt = assertFixPromptOutputSafe(promptBody);

  return { prompt, projectedVerdictLabel, assessment };
}

export function buildSafeFixPrompt(input: ProductionFixPromptInput): ProductionFixPromptResult {
  return buildProductionFixPrompt(input);
}

export function fixPromptInputFromPriority(
  priority: ProductionPriority,
  options: {
    projectName?: string;
    stack?: FixPromptStack;
    findingsById?: Map<string, ScanFinding>;
    currentVerdictStatus?: VerdictStatus;
    currentScore?: number | null;
  } = {}
): ProductionFixPromptInput {
  const linkedFindings = priority.findingIds
    .map((id) => options.findingsById?.get(id))
    .filter((finding): finding is ScanFinding => Boolean(finding));

  const descriptions = linkedFindings
    .map((finding) => finding.description)
    .filter(Boolean)
    .join("\n");

  const affectedFiles =
    priority.affectedFiles.length > 0
      ? priority.affectedFiles
      : linkedFindings.map((finding) => findingFile(finding)).filter(Boolean);

  return {
    projectName: options.projectName,
    issueTitle: priority.title,
    issueDescription: descriptions || priority.reason,
    category: priority.category,
    severity: priority.severity,
    whyItMatters: priority.reason,
    affectedFiles,
    stack: options.stack ?? { languages: [], frameworks: [], services: [] },
    recommendedAction: priority.recommendedAction,
    estimatedFixMinutes: priority.estimatedMinutes,
    projectedScoreImpact: priority.projectedScoreImpact,
    currentVerdictStatus: options.currentVerdictStatus,
    currentScore: options.currentScore,
  };
}

export function fixPromptInputFromFinding(
  finding: ScanFinding,
  options: {
    projectName?: string;
    stack?: FixPromptStack;
    recommendedAction?: string;
    currentVerdictStatus?: VerdictStatus;
    currentScore?: number | null;
    projectedScoreImpact?: number;
    estimatedFixMinutes?: number;
  } = {}
): ProductionFixPromptInput {
  const path = findingFile(finding);
  return {
    projectName: options.projectName,
    issueTitle: finding.title ?? "Production blocker",
    issueDescription: finding.description ?? finding.recommendation ?? "",
    category: finding.category ?? "security",
    severity: finding.severity ?? "high",
    whyItMatters:
      finding.impact ??
      finding.description ??
      "This issue prevents safe production deployment.",
    estimatedImpact: finding.impact,
    affectedFiles: path ? [path] : [],
    stack: options.stack ?? { languages: [], frameworks: [], services: [] },
    recommendedAction:
      options.recommendedAction ??
      finding.recommendation ??
      "Apply the smallest safe fix that resolves this production blocker.",
    estimatedFixMinutes: options.estimatedFixMinutes,
    currentVerdictStatus: options.currentVerdictStatus,
    currentScore: options.currentScore,
    projectedScoreImpact: options.projectedScoreImpact,
  };
}

export function findingsByIdMap(findings: ScanFinding[]): Map<string, ScanFinding> {
  return new Map(
    findings
      .filter((finding) => typeof finding.id === "string" && finding.id.length > 0)
      .map((finding) => [finding.id as string, finding])
  );
}
