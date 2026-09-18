import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openLocalPersistenceStore, type LocalPersistenceStore, type SaveScanResultInput } from "../local-persistence";
import { buildLocalSafeFix, LocalSafeFixError } from "../local-safe-fix";
import { correlationKeyForPersistedFinding } from "../finding-history";

const tempDirs: string[] = [];
const stores: LocalPersistenceStore[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

const WORKSPACE_ID = "ws-1";
const REPOSITORY_ID = "repo-1";

function openStore(): LocalPersistenceStore {
  const store = openLocalPersistenceStore(makeTempDir("seq-safe-fix-"));
  stores.push(store);
  return store;
}

function authFinding(): SaveScanResultInput["findings"][number] {
  return {
    id: "f1",
    title: "Missing authorization check",
    severity: "high",
    category: "authorization",
    rule_id: "native:authz-missing",
    file_path: "src/api/projects/[id]/route.ts",
    start_line: 12,
    recommendation: "Verify that the authenticated user is authorized to access the requested project ID before returning project data.",
    confidence: "high",
    evidence: "return NextResponse.json(project) // no ownership check",
    metadata: { correlationKey: "authz-key" },
  };
}

function saveScan(
  store: LocalPersistenceStore,
  input: {
    scanId: string;
    phase: "complete" | "partial" | "incomplete" | "cancelled";
    findings: SaveScanResultInput["findings"];
    workspaceId?: string;
    repositoryId?: string;
    verdictStatus?: string;
  }
): void {
  const workspaceId = input.workspaceId ?? WORKSPACE_ID;
  const repositoryId = input.repositoryId ?? REPOSITORY_ID;
  store.saveScanResult({
    scan: {
      scanId: input.scanId,
      projectId: "proj-1",
      repositoryId,
      workspaceId,
      scope: "workspace",
      phase: input.phase,
      branch: "main",
      commitSha: "abc123",
      dirty: false,
      durationMs: 100,
      errorMessage: null,
      engines: [{ engine: "native", status: "COMPLETED", durationMs: 100, findingsCount: input.findings.length }],
    },
    findings: input.findings,
    verdict: {
      projectId: "proj-1",
      repositoryId,
      workspaceId,
      status: input.verdictStatus ?? (input.findings.length > 0 ? "not_ready" : "ready_to_ship"),
      score: input.findings.length > 0 ? 40 : 100,
      blockersCount: input.findings.length,
      criticalBlockersCount: 0,
      highBlockersCount: input.findings.length,
      verdict: { status: "not_ready", score: 40 } as never,
    },
  });
}

describe("local-safe-fix: no scan yet", () => {
  it("throws no_scan_yet when nothing has been persisted", () => {
    const store = openStore();
    expect(() => buildLocalSafeFix(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID }, {})).toThrow(
      LocalSafeFixError
    );
    try {
      buildLocalSafeFix(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID }, {});
    } catch (error) {
      expect(error).toBeInstanceOf(LocalSafeFixError);
      expect((error as LocalSafeFixError).code).toBe("no_scan_yet");
    }
  });
});

describe("local-safe-fix: candidate listing", () => {
  it("returns choose_finding with candidates when no correlationKey is given", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", findings: [authFinding()] });

    const result = buildLocalSafeFix(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID }, {});
    expect(result.status).toBe("choose_finding");
    if (result.status === "choose_finding") {
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.correlationKey).toBe("authz-key");
    }
  });

  it("returns no_findings when the latest scan found nothing", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", findings: [] });
    const result = buildLocalSafeFix(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID }, {});
    expect(result.status).toBe("no_findings");
  });
});

describe("local-safe-fix: fix prompt generation", () => {
  it("returns a prompt_ready result referencing the correct finding, with deterministic evidence", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", findings: [authFinding()] });

    const result = buildLocalSafeFix(
      store,
      { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID },
      { correlationKey: "authz-key" }
    );
    expect(result.status).toBe("prompt_ready");
    if (result.status !== "prompt_ready") throw new Error("expected prompt_ready");

    expect(result.finding.correlationKey).toBe("authz-key");
    expect(result.finding.title).toBe("Missing authorization check");
    expect(result.finding.severity).toBe("high");
    expect(result.fixPrompt).toContain("Missing authorization check");
    expect(result.fixPrompt).toContain("src/api/projects/[id]/route.ts");
    expect(result.fixPrompt).toContain("Verify that the authenticated user");
    expect(typeof result.safeFixConfidence).toBe("number");
    expect(typeof result.projectedScore).toBe("number");
    expect(result.note).toContain("does not execute");
  });

  it("throws finding_not_found for an unrecognized correlationKey", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", findings: [authFinding()] });

    expect(() =>
      buildLocalSafeFix(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID }, { correlationKey: "does-not-exist" })
    ).toThrow(LocalSafeFixError);
  });

  it("uses the exact correlation identity finding-history.ts already established", () => {
    const store = openStore();
    const finding = authFinding();
    saveScan(store, { scanId: "s1", phase: "complete", findings: [finding] });
    const expectedKey = correlationKeyForPersistedFinding(
      { ...finding, id: "f1", scanId: "s1" },
      WORKSPACE_ID
    );
    const result = buildLocalSafeFix(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID }, {});
    if (result.status === "choose_finding") {
      expect(result.candidates[0]?.correlationKey).toBe(expectedKey);
    }
  });
});

describe("local-safe-fix: cross-workspace/repository isolation", () => {
  it("a finding in workspace A is never returned when queried under workspace B's identity", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", findings: [authFinding()], workspaceId: "ws-A", repositoryId: "repo-A" });

    expect(() =>
      buildLocalSafeFix(store, { workspaceId: "ws-B", repositoryId: "repo-B" }, { correlationKey: "authz-key" })
    ).toThrow(LocalSafeFixError);
  });

  it("a scan whose repositoryId does not match the requested identity is treated as no scan yet", () => {
    const store = openStore();
    // Same workspaceId, but a different repositoryId (e.g. the git remote changed) --
    // must not be silently treated as this repository's own history.
    saveScan(store, { scanId: "s1", phase: "complete", findings: [authFinding()], workspaceId: WORKSPACE_ID, repositoryId: "repo-other" });

    try {
      buildLocalSafeFix(store, { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID }, {});
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalSafeFixError);
      expect((error as LocalSafeFixError).code).toBe("no_scan_yet");
    }
  });
});

describe("local-safe-fix: no credential leakage", () => {
  it("evidence containing a plausible secret-shaped string is not echoed verbatim into the fix prompt", () => {
    const store = openStore();
    const finding = authFinding();
    finding.evidence = "AKIA1234567890ABCDEF used directly in code";
    saveScan(store, { scanId: "s1", phase: "complete", findings: [finding] });

    const result = buildLocalSafeFix(
      store,
      { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID },
      { correlationKey: "authz-key" }
    );
    expect(result.status).toBe("prompt_ready");
    if (result.status !== "prompt_ready") throw new Error("expected prompt_ready");
    // The prompt never quotes raw finding evidence at all (buildProductionFixPrompt
    // only ever includes title/description/recommendation/file path) -- so a
    // secret-shaped evidence string has no path into the prompt text.
    expect(result.fixPrompt).not.toContain("AKIA1234567890ABCDEF");
  });
});

describe("local-safe-fix: does not execute anything", () => {
  it("the result is plain data -- no callable/executable fields", () => {
    const store = openStore();
    saveScan(store, { scanId: "s1", phase: "complete", findings: [authFinding()] });
    const result = buildLocalSafeFix(
      store,
      { workspaceId: WORKSPACE_ID, repositoryId: REPOSITORY_ID },
      { correlationKey: "authz-key" }
    );
    const values = Object.values(result as Record<string, unknown>);
    for (const value of values) {
      expect(typeof value).not.toBe("function");
    }
  });
});
