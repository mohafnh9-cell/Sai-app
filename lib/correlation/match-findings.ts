import {
  buildFindingCorrelationKey,
  buildFindingCorrelationKeyFromParts,
} from "./finding-identity";
import type {
  FindingCorrelationResult,
  FindingCorrelationStatus,
  GitHubFindingSnapshot,
  LocalFindingCorrelationInput,
} from "./types";

function severityChanged(a: string, b: string): boolean {
  return a.trim().toLowerCase() !== b.trim().toLowerCase();
}

function resolveLocalCorrelationKey(finding: LocalFindingCorrelationInput): string {
  if (finding.correlationKey?.trim()) return finding.correlationKey.trim();
  return buildFindingCorrelationKey({
    ruleId: finding.ruleId,
    filePath: finding.filePath,
    fingerprintMaterial: finding.fingerprintMaterial ?? finding.title ?? "",
  });
}

export function githubSnapshotFromRow(row: {
  id: string;
  rule_id: string;
  file_path: string;
  start_line: number;
  severity: string;
  status: string;
  scan_id: string;
  metadata?: Record<string, unknown> | null;
  commit_sha?: string | null;
}): GitHubFindingSnapshot {
  const correlationKey = buildFindingCorrelationKeyFromParts({
    ruleId: row.rule_id,
    filePath: row.file_path,
    metadata: row.metadata ?? null,
  });
  return {
    id: row.id,
    ruleId: row.rule_id,
    filePath: row.file_path,
    line: row.start_line,
    severity: row.severity,
    status: row.status,
    correlationKey,
    scanId: row.scan_id,
    commitSha: row.commit_sha ?? null,
  };
}

export function correlateLocalFinding(input: {
  local: LocalFindingCorrelationInput;
  githubOpen: GitHubFindingSnapshot[];
  githubHistorical?: GitHubFindingSnapshot[];
}): FindingCorrelationResult {
  const correlationKey = resolveLocalCorrelationKey(input.local);
  const base = {
    correlationKey,
    local: {
      ruleId: input.local.ruleId,
      filePath: input.local.filePath,
      line: input.local.line ?? null,
      severity: input.local.severity,
      title: input.local.title ?? null,
    },
  };

  const openMatches = input.githubOpen.filter((g) => g.correlationKey === correlationKey);

  if (openMatches.length > 1) {
    return {
      ...base,
      status: "ambiguous",
      candidates: openMatches.length,
      reason: "Multiple open GitHub findings share the same correlation identity.",
    };
  }

  if (openMatches.length === 1) {
    const github = openMatches[0]!;
    const status: FindingCorrelationStatus = severityChanged(input.local.severity, github.severity)
      ? "changed"
      : "matched";
    return {
      ...base,
      status,
      github: {
        findingId: github.id,
        ruleId: github.ruleId,
        filePath: github.filePath,
        line: github.line,
        severity: github.severity,
        status: github.status,
        scanId: github.scanId,
        commitSha: github.commitSha,
      },
      reason:
        status === "changed"
          ? "Same rule and file identity, but severity differs on GitHub."
          : undefined,
    };
  }

  const historical = input.githubHistorical ?? [];
  const historicalMatches = historical.filter((g) => g.correlationKey === correlationKey);
  if (historicalMatches.length > 1) {
    return {
      ...base,
      status: "ambiguous",
      candidates: historicalMatches.length,
      reason: "Multiple historical GitHub findings match; cannot determine resolution state safely.",
    };
  }

  if (historicalMatches.length === 1) {
    const github = historicalMatches[0]!;
    return {
      ...base,
      status: "resolved",
      github: {
        findingId: github.id,
        ruleId: github.ruleId,
        filePath: github.filePath,
        line: github.line,
        severity: github.severity,
        status: github.status,
        scanId: github.scanId,
        commitSha: github.commitSha,
      },
      reason: "Local analysis no longer reports this finding; a prior GitHub finding existed.",
    };
  }

  return {
    ...base,
    status: "unmatched",
    reason: "No GitHub finding with a matching correlation identity at the selected commit scope.",
  };
}

export function correlateCommitSha(input: {
  localCommitSha: string | null;
  githubCommitSha: string | null;
}): { status: "matched" | "unmatched" | "ambiguous"; reason?: string } {
  if (!input.localCommitSha) {
    return {
      status: "unmatched",
      reason: "Local analysis has no verified commit SHA.",
    };
  }
  if (!input.githubCommitSha) {
    return {
      status: "unmatched",
      reason: "No GitHub scan commit is available for comparison.",
    };
  }
  const local = input.localCommitSha.trim().toLowerCase();
  const github = input.githubCommitSha.trim().toLowerCase();
  if (local === github || github.startsWith(local) || local.startsWith(github)) {
    return { status: "matched" };
  }
  return {
    status: "unmatched",
    reason: "Local commit SHA does not match the GitHub scan commit.",
  };
}

export function correlatePullRequestByHeadSha(input: {
  commitSha: string | null;
  candidates: Array<{ pullRequestNumber: number; headCommitSha: string }>;
}): { status: "matched" | "unmatched" | "ambiguous"; pullRequestNumber?: number; reason?: string } {
  if (!input.commitSha) {
    return {
      status: "unmatched",
      reason: "PR correlation requires a verified local commit SHA.",
    };
  }
  const normalized = input.commitSha.trim().toLowerCase();
  const matches = input.candidates.filter(
    (pr) => pr.headCommitSha.trim().toLowerCase() === normalized
  );
  if (matches.length === 0) {
    return {
      status: "unmatched",
      reason: "No pull request head SHA matches the local commit.",
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      reason: `Multiple pull requests (${matches.length}) share the same head SHA.`,
    };
  }
  return {
    status: "matched",
    pullRequestNumber: matches[0]!.pullRequestNumber,
  };
}

export function correlateLocalFindingsBatch(input: {
  localFindings: LocalFindingCorrelationInput[];
  githubOpen: GitHubFindingSnapshot[];
  githubHistorical?: GitHubFindingSnapshot[];
}): FindingCorrelationResult[] {
  return input.localFindings.map((local) =>
    correlateLocalFinding({
      local,
      githubOpen: input.githubOpen,
      githubHistorical: input.githubHistorical,
    })
  );
}
