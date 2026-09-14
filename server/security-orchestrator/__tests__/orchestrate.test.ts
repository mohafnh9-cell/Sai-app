import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

/**
 * Phase 36, section 35/36: the orchestrator-level integration tests,
 * including the REAL end-to-end run (labeled explicitly per section 36's
 * requirement: REAL LOCAL / MOCKED / NOT VERIFIED).
 *
 * GitHub fetch is mocked (no real credential available for an arbitrary
 * repo in CI/dev) -- but when OPENGREP_BINARY_PATH/TRIVY_BINARY_PATH are
 * set, engine execution itself is REAL, exercised through the exact same
 * server/security-jobs/worker-run-job.ts code a deployed worker uses.
 */
const hasRealEngines = Boolean(process.env.OPENGREP_BINARY_PATH?.trim() && process.env.TRIVY_BINARY_PATH?.trim());

const VULNERABLE_JS = `const db = require("./db");
async function getUser(req, res) {
  const userId = req.query.id;
  const query = "SELECT * FROM users WHERE id = " + userId;
  const result = await db.raw(query);
  res.json(result);
}
module.exports = { getUser };
`;

const VULNERABLE_PACKAGE_JSON = JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: { lodash: "4.17.15" } });
const VULNERABLE_LOCKFILE = JSON.stringify({
  name: "fixture",
  lockfileVersion: 2,
  packages: { "": { dependencies: { lodash: "4.17.15" } }, "node_modules/lodash": { version: "4.17.15" } },
  dependencies: { lodash: { version: "4.17.15" } },
});

const REPO_FILES = [
  { path: "package.json", content: VULNERABLE_PACKAGE_JSON },
  { path: "package-lock.json", content: VULNERABLE_LOCKFILE },
  { path: "app/users.js", content: VULNERABLE_JS },
];

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
        return {
          repositoryId: 1,
          owner: "acme",
          repo: "widgets",
          isPrivate: false,
          defaultBranch: "main",
          commitSha: "abc123",
          files: REPO_FILES.map((f) => ({ ...f, size: f.content.length, sha: "x" })),
          discoveredFiles: REPO_FILES.length,
          totalBytes: REPO_FILES.reduce((n, f) => n + f.content.length, 0),
          omissions: [],
        };
      }
    },
  };
});

vi.mock("@/server/production-verdict/service", () => ({
  getCurrentProductionVerdict: vi.fn(async () => null),
}));

const ORG_A = "org-a";
const ORG_B = "org-b";
const PROJECT_A = "project-a";
const SCAN_A = "scan-a";

function tables(): FakeTables {
  return {
    security_jobs: [],
    security_job_events: [],
    external_engine_findings: [],
    engine_executions: [],
    finding_correlations: [],
    attack_chains: [],
    scan_findings: [],
    scans: [{ id: SCAN_A, commit_sha: "abc123", branch: "main" }],
    projects: [{ id: PROJECT_A, organization_id: ORG_A, github_repo: "acme/widgets" }],
    attack_authorizations: [],
    dynamic_target_verifications: [],
  };
}

afterEach(() => {
  vi.resetModules();
});

describe.skipIf(!hasRealEngines)("Phase 36 -- runSecurityOrchestration (REAL LOCAL end-to-end)", () => {
  it(
    "discovers, plans, creates real SecurityJobs, drains them through the REAL worker code (real opengrep-core + real trivy), and produces coverage + telemetry",
    async () => {
      const { runSecurityOrchestration } = await import("../orchestrate");
      const t = tables();
      const admin = createFakeAdmin(t);

      const result = await runSecurityOrchestration(admin as never, {
        scanId: SCAN_A,
        organizationId: ORG_A,
        projectId: PROJECT_A,
        files: REPO_FILES,
        githubRepo: "acme/widgets",
        depth: "STANDARD",
        drainInline: true,
      });

      expect(result.plan.selectedEngines).toEqual(expect.arrayContaining(["native", "crypto", "opengrep", "trivy"]));
      expect(result.jobsCreated).toBeGreaterThan(0);
      expect(result.coverage.executed).toBeGreaterThan(0);
      // Real findings from both real engines should be visible in coverage.
      expect(result.coverage.entries.find((e) => e.engine === "opengrep")?.findingsCount).toBeGreaterThan(0);
      expect(result.coverage.entries.find((e) => e.engine === "trivy")?.findingsCount).toBeGreaterThan(0);
      expect(result.telemetry.totalDurationMs).toBeGreaterThan(0);

      const eventTypes = (t.security_job_events ?? []).map((e) => e.event_type);
      expect(eventTypes).toEqual(
        expect.arrayContaining(["DISCOVERY_STARTED", "PLAN_CREATED", "JOB_QUEUED", "CORRELATION_COMPLETED", "VERDICT_GENERATED"])
      );
    },
    60_000
  );
});

describe("Phase 36 -- runSecurityOrchestration (billing, tenant isolation, idempotency -- no binary required)", () => {
  it("does NOT consume a billing credit per SecurityJob -- creating multiple jobs for one scan is not a second billable event (section 25)", async () => {
    const t = tables();
    t.subscriptions = [];
    const admin = createFakeAdmin(t);

    const { runSecurityOrchestration } = await import("../orchestrate");
    await runSecurityOrchestration(admin as never, {
      scanId: SCAN_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      files: [{ path: "package.json", content: "{}" }],
      githubRepo: "acme/widgets",
      depth: "STANDARD",
      drainInline: false,
    });

    expect(t.subscriptions).toHaveLength(0); // no free-credit consumption triggered by job creation
  });

  it("scopes every job/event to the correct organization/project/scan (section 26)", async () => {
    const t = tables();
    const admin = createFakeAdmin(t);
    const { runSecurityOrchestration } = await import("../orchestrate");

    await runSecurityOrchestration(admin as never, {
      scanId: SCAN_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      files: [{ path: "package.json", content: "{}" }],
      githubRepo: "acme/widgets",
      depth: "STANDARD",
      drainInline: false,
    });

    const orgBJobs = (t.security_jobs ?? []).filter((r) => r.organization_id === ORG_B);
    expect(orgBJobs).toHaveLength(0);
    for (const job of t.security_jobs ?? []) {
      expect(job.organization_id).toBe(ORG_A);
      expect(job.project_id).toBe(PROJECT_A);
      expect(job.scan_id).toBe(SCAN_A);
    }
  });

  it("is idempotent: running orchestration twice for the same scan does not create duplicate jobs (section 27)", async () => {
    const t = tables();
    const admin = createFakeAdmin(t);
    const { runSecurityOrchestration } = await import("../orchestrate");

    const files = [{ path: "package.json", content: "{}" }];
    const first = await runSecurityOrchestration(admin as never, {
      scanId: SCAN_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      files,
      githubRepo: "acme/widgets",
      depth: "STANDARD",
      drainInline: false,
    });
    const jobCountAfterFirst = (t.security_jobs ?? []).length;

    const second = await runSecurityOrchestration(admin as never, {
      scanId: SCAN_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      files,
      githubRepo: "acme/widgets",
      depth: "STANDARD",
      drainInline: false,
    });

    expect((t.security_jobs ?? []).length).toBe(jobCountAfterFirst);
    expect(second.jobsCreated).toBe(first.jobsCreated);
  });

  it("Phase 38 concurrency: two simultaneous reviews for the SAME tenant (different scans) never cross-contaminate jobs/events", async () => {
    const t = tables();
    t.scans = [
      { id: SCAN_A, commit_sha: "abc123", branch: "main" },
      { id: "scan-a2", commit_sha: "def456", branch: "main" },
    ];
    const admin = createFakeAdmin(t);
    const { runSecurityOrchestration } = await import("../orchestrate");

    const [first, second] = await Promise.all([
      runSecurityOrchestration(admin as never, {
        scanId: SCAN_A,
        organizationId: ORG_A,
        projectId: PROJECT_A,
        files: [{ path: "package.json", content: "{}" }],
        githubRepo: "acme/widgets",
        depth: "STANDARD",
        drainInline: false,
      }),
      runSecurityOrchestration(admin as never, {
        scanId: "scan-a2",
        organizationId: ORG_A,
        projectId: PROJECT_A,
        files: [{ path: "package.json", content: "{}" }],
        githubRepo: "acme/widgets",
        depth: "STANDARD",
        drainInline: false,
      }),
    ]);

    expect(first.plan.scanId).toBe(SCAN_A);
    expect(second.plan.scanId).toBe("scan-a2");
    const scanAJobs = (t.security_jobs ?? []).filter((r) => r.scan_id === SCAN_A);
    const scanA2Jobs = (t.security_jobs ?? []).filter((r) => r.scan_id === "scan-a2");
    expect(scanAJobs.length).toBeGreaterThan(0);
    expect(scanA2Jobs.length).toBeGreaterThan(0);
    for (const job of scanAJobs) expect(job.scan_id).toBe(SCAN_A);
    for (const job of scanA2Jobs) expect(job.scan_id).toBe("scan-a2");
  });

  it("Phase 38 concurrency: two simultaneous reviews for DIFFERENT tenants never leak jobs/events across organizations", async () => {
    const t = tables();
    t.scans = [
      { id: SCAN_A, commit_sha: "abc123", branch: "main" },
      { id: "scan-b1", commit_sha: "def456", branch: "main" },
    ];
    t.projects = [
      { id: PROJECT_A, organization_id: ORG_A, github_repo: "acme/widgets" },
      { id: "project-b", organization_id: ORG_B, github_repo: "acme/other" },
    ];
    const admin = createFakeAdmin(t);
    const { runSecurityOrchestration } = await import("../orchestrate");

    await Promise.all([
      runSecurityOrchestration(admin as never, {
        scanId: SCAN_A,
        organizationId: ORG_A,
        projectId: PROJECT_A,
        files: [{ path: "package.json", content: "{}" }],
        githubRepo: "acme/widgets",
        depth: "STANDARD",
        drainInline: false,
      }),
      runSecurityOrchestration(admin as never, {
        scanId: "scan-b1",
        organizationId: ORG_B,
        projectId: "project-b",
        files: [{ path: "package.json", content: "{}" }],
        githubRepo: "acme/other",
        depth: "STANDARD",
        drainInline: false,
      }),
    ]);

    const orgAJobs = (t.security_jobs ?? []).filter((r) => r.organization_id === ORG_A);
    const orgBJobs = (t.security_jobs ?? []).filter((r) => r.organization_id === ORG_B);
    expect(orgAJobs.length).toBeGreaterThan(0);
    expect(orgBJobs.length).toBeGreaterThan(0);
    for (const job of orgAJobs) {
      expect(job.project_id).toBe(PROJECT_A);
      expect(job.scan_id).toBe(SCAN_A);
    }
    for (const job of orgBJobs) {
      expect(job.project_id).toBe("project-b");
      expect(job.scan_id).toBe("scan-b1");
    }
  });

  it("adversarial audit fix (section 37): a foreign job (another scan's, already queued) claimed during drainInline is run to completion, never abandoned stuck in RUNNING", async () => {
    const t = tables();
    // Pre-seed a QUEUED job that does NOT belong to this orchestration run
    // at all -- simulates a real shared queue where other tenants'/scans'
    // jobs are already waiting.
    t.security_jobs = [
      {
        id: "foreign-job-1",
        organization_id: "org-foreign",
        project_id: "project-foreign",
        scan_id: "scan-foreign",
        engine: "crypto",
        engine_version: "1.0.0",
        capabilities: [],
        status: "QUEUED",
        cancel_requested: false,
        priority: 100, // higher priority so it's claimed FIRST
        attempt: 0,
        max_attempts: 3,
        timeout_ms: 60_000,
        idempotency_key: "foreign-key",
        requested_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ];
    t.projects = [
      { id: PROJECT_A, organization_id: ORG_A, github_repo: "acme/widgets" },
      { id: "project-foreign", organization_id: "org-foreign", github_repo: null },
    ];
    const admin = createFakeAdmin(t);
    const { runSecurityOrchestration } = await import("../orchestrate");

    await runSecurityOrchestration(admin as never, {
      scanId: SCAN_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      files: [{ path: "app.ts", content: "const x = 1;" }],
      githubRepo: "acme/widgets",
      depth: "STANDARD",
      drainInline: true,
    });

    const foreignJob = t.security_jobs?.find((r) => r.id === "foreign-job-1");
    // Must be completed (or failed, since it has no GitHub repo) -- NEVER
    // left stuck in RUNNING just because it wasn't one of this call's own jobs.
    expect(foreignJob?.status).not.toBe("RUNNING");
    expect(foreignJob?.status).not.toBe("QUEUED");
    // Performance Audit #3 regression guard: the drain loop passes this
    // scan's (SCAN_A / acme/widgets) pre-fetched files/repo ONLY to its own
    // jobs. project-foreign has github_repo: null -- if the foreign job had
    // incorrectly received SCAN_A's preFetchedFiles/githubRepo instead of
    // resolving its own (null) repository, it would NOT fail with
    // "no_repository" here, and worse, would have run the crypto engine
    // against another tenant's files entirely.
    expect(foreignJob?.status).toBe("FAILED");
    expect((foreignJob?.error as { code?: string } | null)?.code).toBe("no_repository");
  });

  it("runs AI reasoning as part of the full orchestration flow when enabled (Phase 37 wiring), fed by real findings collected this run, and it never blocks the verdict stage", async () => {
    vi.resetModules();
    vi.stubEnv("AI_REASONING_ENABLED", "true");
    vi.stubEnv("AI_PROVIDER", "test-double");

    // Math.random() near "session"/"token" is a real, binary-free finding
    // the native Crypto engine (Phase 35) flags for real -- no
    // opengrep/trivy binary needed. Overrides the shared module-level
    // GitHub mock (used by the other tests' SQLi/lockfile fixture) with
    // this test's own content, since runClaimedSecurityJob re-fetches
    // "repository files" via that mock during drainInline.
    const cryptoFile = { path: "auth/session.ts", content: "const sessionToken = Math.random().toString(36);" };
    vi.doMock("@/server/github-automation/token-resolver", () => ({
      resolveOrganizationGitHubToken: vi.fn(async () => ({ token: "gh-token-fake", userId: "user-1" })),
    }));
    vi.doMock("@/lib/github/repository-service", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/github/repository-service")>();
      return {
        ...actual,
        GitHubRepositoryService: class {
          dispose() {}
          async fetchSnapshot() {
            return {
              repositoryId: 1,
              owner: "acme",
              repo: "widgets",
              isPrivate: false,
              defaultBranch: "main",
              commitSha: "abc123",
              files: [{ ...cryptoFile, size: cryptoFile.content.length, sha: "x" }],
              discoveredFiles: 1,
              totalBytes: cryptoFile.content.length,
              omissions: [],
            };
          }
        },
      };
    });
    vi.doMock("@/server/production-verdict/service", () => ({
      getCurrentProductionVerdict: vi.fn(async () => null),
    }));

    const t = tables();
    const admin = createFakeAdmin(t);
    const { runSecurityOrchestration } = await import("../orchestrate");

    const result = await runSecurityOrchestration(admin as never, {
      scanId: SCAN_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      files: [cryptoFile],
      githubRepo: "acme/widgets",
      depth: "STANDARD",
      drainInline: true,
    });

    expect(result.coverage.entries.find((e) => e.engine === "crypto")?.findingsCount).toBeGreaterThan(0);
    expect(result.aiReasoning.status).toBe("COMPLETED");
    expect(result.verdictStatus).toBeDefined(); // verdict stage still ran regardless
    const eventTypes = (t.security_job_events ?? []).map((e) => e.event_type);
    expect(eventTypes).toContain("AI_REASONING_COMPLETED");
  });
});
