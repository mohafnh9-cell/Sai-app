import { describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

/**
 * Performance Audit finding #3 (worker/engine execution): before this fix,
 * every SecurityJob independently called GitHubRepositoryService.fetchSnapshot()
 * inside runClaimedSecurityJob(), even though the orchestrator's inline
 * drain loop (server/security-orchestrator/orchestrate.ts) already has the
 * exact same commit's files in memory from its own earlier discovery/planning
 * step. For a typical scan with 4 engine jobs (opengrep, trivy, crypto,
 * scorecard -- server/security-engines/registry.ts), that meant 4 redundant
 * full tarball downloads+extractions of the same commit, run one after
 * another (the drain loop is sequential).
 *
 * This test proves two things with a synthetic but realistic fixture (no
 * real GitHub credential is available in CI):
 *   1. Correctness: passing `preFetchedFiles` makes runClaimedSecurityJob
 *      skip GitHubRepositoryService entirely -- zero fetch calls.
 *   2. Magnitude: with a mocked fetch latency standing in for a real
 *      network+extraction round trip, N sequential jobs go from
 *      N * fetchLatency to ~0 added latency for the fetch step itself.
 *
 * The mocked latency (150ms) is a stand-in, not a measured production
 * number -- there is no live worker/GitHub App credential in this
 * environment to measure a real tarball fetch. It exists only to make the
 * *shape* of the saving (linear-in-N -> constant) observable and testable;
 * do not quote it as a real-world timing.
 */

const SYNTHETIC_FETCH_LATENCY_MS = 150;
const ENGINE_COUNT = 4; // opengrep, trivy, crypto, scorecard

const FILES = [{ path: "app/index.js", content: "console.log('hello');\n" }];

let fetchSnapshotCalls = 0;

vi.mock("@/server/github-automation/token-resolver", () => ({
  resolveOrganizationGitHubToken: vi.fn(async () => ({ token: "gh-token-fake", userId: "user-1" })),
}));

vi.mock("@/lib/github/repository-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github/repository-service")>();
  return {
    ...actual,
    GitHubRepositoryService: class {
      dispose() {}
      async fetchSnapshot() {
        fetchSnapshotCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, SYNTHETIC_FETCH_LATENCY_MS));
        return {
          repositoryId: 1,
          owner: "acme",
          repo: "widgets",
          isPrivate: false,
          defaultBranch: "main",
          commitSha: "abc123",
          files: FILES.map((f) => ({ ...f, size: f.content.length, sha: "x" })),
          discoveredFiles: FILES.length,
          totalBytes: FILES.reduce((sum, f) => sum + f.content.length, 0),
          omissions: [],
        };
      }
    },
  };
});

// Every engine fails fast (no binary configured) -- irrelevant to this
// benchmark, which only measures the fetch step runClaimedSecurityJob does
// before it ever reaches engine execution.
vi.stubEnv("OPENGREP_BINARY_PATH", "");
vi.stubEnv("TRIVY_BINARY_PATH", "");
vi.stubEnv("SCORECARD_BINARY_PATH", "");

const ORG_A = "org-a";
const PROJECT_A = "project-a";
const SCAN_A = "scan-a";

function tables(): FakeTables {
  return {
    security_jobs: [],
    security_job_events: [],
    scans: [{ id: SCAN_A, commit_sha: "abc123", branch: "main" }],
    projects: [{ id: PROJECT_A, organization_id: ORG_A, github_repo: "acme/widgets" }],
    external_engine_findings: [],
    engine_executions: [],
    finding_correlations: [],
    scan_findings: [],
  };
}

async function runNJobsSequentially(preFetched: boolean) {
  const { createSecurityJob, claimNextSecurityJob } = await import("../service");
  const { runClaimedSecurityJob } = await import("../worker-run-job");

  const t = tables();
  const admin = createFakeAdmin(t) as never;

  const engines = ["opengrep", "trivy", "crypto", "scorecard"] as const;
  for (const engine of engines) {
    await createSecurityJob(admin, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: SCAN_A,
      engine,
      engineVersion: "1.0.0",
      capabilities: [],
    });
  }

  const start = Date.now();
  for (let i = 0; i < engines.length; i += 1) {
    const claimed = await claimNextSecurityJob(admin, "bench");
    if (!claimed) break;
    await runClaimedSecurityJob(
      admin,
      claimed,
      preFetched ? { preFetchedFiles: FILES, githubRepo: "acme/widgets" } : undefined
    );
  }
  return Date.now() - start;
}

describe("Performance Audit #3 -- redundant per-engine repository re-fetch", () => {
  it("BEFORE (no preFetchedFiles): each of the 4 engine jobs calls fetchSnapshot itself", async () => {
    fetchSnapshotCalls = 0;
    const elapsedMs = await runNJobsSequentially(false);

    expect(fetchSnapshotCalls).toBe(ENGINE_COUNT);
    // Sequential drain -> latency scales with N * fetch cost, not a fixed cost.
    expect(elapsedMs).toBeGreaterThanOrEqual(ENGINE_COUNT * SYNTHETIC_FETCH_LATENCY_MS * 0.8);

    console.log(
      `PERF_AUDIT_3_BEFORE { engines: ${ENGINE_COUNT}, fetchCalls: ${fetchSnapshotCalls}, elapsedMs: ${elapsedMs} }`
    );
  });

  it("AFTER (preFetchedFiles passed): zero fetchSnapshot calls, no fetch latency added", async () => {
    fetchSnapshotCalls = 0;
    const elapsedMs = await runNJobsSequentially(true);

    expect(fetchSnapshotCalls).toBe(0);
    // No fetch latency was added at all; leave generous headroom for
    // fake-admin/test-runner overhead under parallel CI load rather than
    // asserting against the raw synthetic latency itself.
    expect(elapsedMs).toBeLessThan(SYNTHETIC_FETCH_LATENCY_MS * ENGINE_COUNT * 0.5);

    console.log(
      `PERF_AUDIT_3_AFTER  { engines: ${ENGINE_COUNT}, fetchCalls: ${fetchSnapshotCalls}, elapsedMs: ${elapsedMs} }`
    );
  });
});
