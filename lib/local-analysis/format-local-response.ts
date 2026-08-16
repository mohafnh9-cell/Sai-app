import type { LocalAnalysisScope } from "./constants";
import type { LocalFindingPublic } from "./types";

export function buildLocalStatusSummary(input: {
  scope: LocalAnalysisScope;
  verdictStatus: string;
  score: number | null;
  findings: LocalFindingPublic[];
  headline?: string;
  executiveSummary?: string;
  topPriorities?: string[];
  reason?: string;
}): string {
  const lines: string[] = [
    "SEQURAI — Production Verdict (Local Workspace)",
    "",
    "SOURCE: Local workspace",
    `SCOPE: ${formatScopeLabel(input.scope)}`,
    "",
    "STATUS",
    input.headline ?? input.verdictStatus.toUpperCase(),
  ];

  if (input.score != null) {
    lines.push(`SCORE: ${input.score}/100`);
  } else {
    lines.push("SCORE: unavailable (insufficient evidence for a numeric score)");
  }

  if (input.executiveSummary) {
    lines.push("", "SUMMARY", input.executiveSummary);
  }

  if (input.reason) {
    lines.push("", "NOTE", input.reason);
  }

  const actionable = input.findings.filter(
    (finding) =>
      !finding.safeToIgnore &&
      (finding.severity === "critical" ||
        finding.severity === "high" ||
        finding.severity === "medium")
  );

  if (actionable.length > 0) {
    lines.push("", "MAIN FINDINGS");
    for (const finding of actionable.slice(0, 6)) {
      lines.push(
        "",
        `${finding.severity.toUpperCase()} — ${finding.title}`,
        `File: ${finding.filePath}:${finding.line}`,
        finding.description
      );
      if (finding.evidence) {
        lines.push(`Evidence: ${finding.evidence}`);
      }
      lines.push(`What to do: ${finding.remediation}`);
    }
  }

  if (input.topPriorities && input.topPriorities.length > 0) {
    lines.push("", "TOP PRIORITIES");
    for (const priority of input.topPriorities) {
      lines.push(`- ${priority}`);
    }
  }

  const hasSecretFinding = actionable.some((finding) =>
    `${finding.title} ${finding.category} ${finding.ruleId}`.toLowerCase().match(/secret|credential|api key/)
  );

  if (hasSecretFinding) {
    lines.push("", "NEXT STEPS");
    lines.push("1. Review the highlighted values in your local workspace.");
    lines.push("2. Remove real credentials from source and rotate them if they were ever exposed.");
    lines.push("3. Re-run sequrai_local_audit after fixing.");
  } else if (actionable.length > 0) {
    lines.push("", "NEXT STEPS");
    lines.push("1. Address the findings above in your local workspace.");
    lines.push("2. Re-run sequrai_local_audit to verify.");
  }

  lines.push(
    "",
    "LIMITATION",
    "This verdict analyzes files on disk in your authorized workspace only. Remote MCP tools analyze your connected repository separately."
  );

  return lines.join("\n");
}

function formatScopeLabel(scope: LocalAnalysisScope): string {
  switch (scope) {
    case "workspace":
      return "Full workspace";
    case "working_tree":
      return "Working tree changes";
    case "staged":
      return "Staged changes";
    case "diff":
      return "Unstaged diff";
    default:
      return scope;
  }
}
