import { describe, expect, it } from "vitest";
import {
  correlateCommitSha,
  correlateLocalFinding,
  correlateLocalFindingsBatch,
  correlatePullRequestByHeadSha,
  githubSnapshotFromRow,
} from "@/lib/correlation/match-findings";
import { buildFindingCorrelationKey } from "@/lib/correlation/finding-identity";

const KEY_A = buildFindingCorrelationKey({
  ruleId: "secrets.exposed",
  filePath: "src/config.ts",
  fingerprintMaterial: "abc",
});

function githubFinding(overrides: Partial<Parameters<typeof githubSnapshotFromRow>[0]> = {}) {
  return githubSnapshotFromRow({
    id: "gh-1",
    rule_id: "secrets.exposed",
    file_path: "src/config.ts",
    start_line: 10,
    severity: "high",
    status: "open",
    scan_id: "scan-1",
    metadata: { correlationMaterial: "abc", correlationKey: KEY_A },
    commit_sha: "abc123def456",
    ...overrides,
  });
}

describe("correlateLocalFinding", () => {
  it("matches exact finding identity even when line numbers differ", () => {
    const result = correlateLocalFinding({
      local: {
        ruleId: "secrets.exposed",
        filePath: "src/config.ts",
        line: 12,
        severity: "high",
        correlationKey: KEY_A,
      },
      githubOpen: [githubFinding({ start_line: 10 })],
    });
    expect(result.status).toBe("matched");
    expect(result.github?.findingId).toBe("gh-1");
  });

  it("returns unmatched for different rule", () => {
    const result = correlateLocalFinding({
      local: {
        ruleId: "other.rule",
        filePath: "src/config.ts",
        severity: "high",
        correlationKey: buildFindingCorrelationKey({
          ruleId: "other.rule",
          filePath: "src/config.ts",
          fingerprintMaterial: "abc",
        }),
      },
      githubOpen: [githubFinding()],
    });
    expect(result.status).toBe("unmatched");
  });

  it("returns ambiguous for multiple GitHub candidates", () => {
    const result = correlateLocalFinding({
      local: {
        ruleId: "secrets.exposed",
        filePath: "src/config.ts",
        severity: "high",
        correlationKey: KEY_A,
      },
      githubOpen: [githubFinding({ id: "gh-1" }), githubFinding({ id: "gh-2" })],
    });
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toBe(2);
  });

  it("marks severity drift as changed", () => {
    const result = correlateLocalFinding({
      local: {
        ruleId: "secrets.exposed",
        filePath: "src/config.ts",
        severity: "critical",
        correlationKey: KEY_A,
      },
      githubOpen: [githubFinding({ severity: "high" })],
    });
    expect(result.status).toBe("changed");
  });

  it("marks resolved when historical GitHub finding existed", () => {
    const result = correlateLocalFinding({
      local: {
        ruleId: "secrets.exposed",
        filePath: "src/config.ts",
        severity: "high",
        correlationKey: KEY_A,
      },
      githubOpen: [],
      githubHistorical: [githubFinding({ status: "fixed" })],
    });
    expect(result.status).toBe("resolved");
  });
});

describe("commit and PR correlation", () => {
  it("requires commit SHA for commit correlation", () => {
    expect(
      correlateCommitSha({ localCommitSha: null, githubCommitSha: "abc" }).status
    ).toBe("unmatched");
  });

  it("matches PR only by head SHA", () => {
    const matched = correlatePullRequestByHeadSha({
      commitSha: "abc123",
      candidates: [{ pullRequestNumber: 42, headCommitSha: "abc123" }],
    });
    expect(matched.status).toBe("matched");
    expect(matched.pullRequestNumber).toBe(42);
  });

  it("does not match PR by branch name alone", () => {
    const unmatched = correlatePullRequestByHeadSha({
      commitSha: null,
      candidates: [{ pullRequestNumber: 42, headCommitSha: "abc123" }],
    });
    expect(unmatched.status).toBe("unmatched");
  });

  it("returns ambiguous for duplicate PR head SHAs", () => {
    const result = correlatePullRequestByHeadSha({
      commitSha: "abc123",
      candidates: [
        { pullRequestNumber: 1, headCommitSha: "abc123" },
        { pullRequestNumber: 2, headCommitSha: "abc123" },
      ],
    });
    expect(result.status).toBe("ambiguous");
  });
});

describe("correlateLocalFindingsBatch", () => {
  it("never uses absolute local paths in identity", () => {
    const key = buildFindingCorrelationKey({
      ruleId: "rule",
      filePath: "/Users/dev/project/src/a.ts",
      fingerprintMaterial: "x",
    });
    const [result] = correlateLocalFindingsBatch({
      localFindings: [
        {
          ruleId: "rule",
          filePath: "/Users/dev/project/src/a.ts",
          severity: "high",
          correlationKey: key,
        },
      ],
      githubOpen: [],
    });
    expect(result.correlationKey).toBe(key);
    expect(result.local.filePath).toContain("/Users/dev");
    expect(result.status).toBe("unmatched");
  });
});
