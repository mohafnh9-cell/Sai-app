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
  credentialsSkipped?: number;
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
      const location = finding.filePath
        ? finding.line != null
          ? `${finding.filePath}:${finding.line}`
          : finding.filePath
        : "location not tied to a single file";
      lines.push(
        "",
        `${finding.severity.toUpperCase()} — ${finding.title}`,
        `File: ${location}`,
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

  // Found via Full System Adversarial Validation V1: real credential-shaped
  // files (.env, private keys, etc.) are deliberately never read off disk
  // (see CREDENTIAL_BASENAME_PATTERNS, workspace.ts) -- a real secret
  // committed to an actual .env file is structurally invisible to
  // secrets.exposed/secrets.public-env through this scan, no matter how
  // clean the rest of the verdict looks. That fact was previously only a
  // buried numeric field (snapshot.credentialsSkipped) in the JSON
  // response -- never mentioned in this narrative, the text an agent or
  // developer actually reads to decide whether they're covered.
  if (input.credentialsSkipped && input.credentialsSkipped > 0) {
    lines.push(
      "",
      "NOT SCANNED",
      `${input.credentialsSkipped} credential-shaped file(s) (e.g. .env, private keys, credentials files) were not read, for privacy. ` +
        "Their contents were never analyzed and are not reflected in this verdict -- review them yourself for hardcoded or leaked secrets."
    );
  }

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
