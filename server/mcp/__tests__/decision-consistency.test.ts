import { describe, expect, it } from "vitest";
import { McpError, type McpAuthContext } from "@/server/mcp/auth";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { canIDeploy } from "@/server/mcp/tools/can-i-deploy";
import { productionHistory } from "@/server/mcp/tools/production-history";
import { safeFix } from "@/server/mcp/tools/safe-fix";
import { whatChanged } from "@/server/mcp/tools/what-changed";
import { createFakeAdmin, type FakeTables } from "./fake-admin";
import { buildVerdictFixture, verdictRow } from "./verdict-fixture";
import { testMcpAuthContext } from "./test-context";

// Phase Z v2 Pass 3 (HIGH-001/002/003, Block Q): every decision-facing MCP
// tool must describe the SAME evaluation with the SAME decision semantics.
// These tests drive all four tools from one set of tables and assert they
// agree, so a tool can never say "nothing to fix" / "ship when you're ready"
// while can_i_deploy says MORE_ANALYSIS_REQUIRED.

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const t = getMcpTranslator("en");

function ctx(admin: ReturnType<typeof createFakeAdmin>): McpAuthContext {
  return testMcpAuthContext(admin, { organizationId: ORG });
}

function tables(overrides: Partial<FakeTables> = {}): FakeTables {
  return {
    projects: [
      { id: PROJECT, name: "Alpha", github_repo: "acme/alpha", organization_id: ORG, created_at: "2026-01-01" },
    ],
    production_verdicts: [],
    repository_scan_state: [],
    github_webhooks: [
      { project_id: PROJECT, active: true, callback_url: null, last_delivery_at: "2026-01-01T00:00:00.000Z" },
    ],
    repository_sync_status: [
      { project_id: PROJECT, commit_sha: null, connection_status: "connected", last_error: null },
    ],
    scan_findings: [],
    scans: [],
    profiles: [],
    ...overrides,
  };
}

async function runAll(fake: FakeTables) {
  const admin = createFakeAdmin(fake);
  const c = ctx(admin);
  return {
    deploy: await canIDeploy(c, {}, t),
    fix: await safeFix(c, {}, t),
    changed: await whatChanged(c, {}, t),
    history: await productionHistory(c, {}, t),
  };
}

// analysis_failed verdicts are excluded from the comparable "valid review"
// set, so what_changed has nothing to compare and refuses (fails
// conservatively) rather than reporting anything.
async function runAllExceptWhatChanged(fake: FakeTables) {
  const admin = createFakeAdmin(fake);
  const c = ctx(admin);
  return {
    deploy: await canIDeploy(c, {}, t),
    fix: await safeFix(c, {}, t),
    history: await productionHistory(c, {}, t),
    whatChangedRefuses: await whatChanged(c, {}, t).then(
      () => false,
      (error: unknown) => error instanceof McpError && error.code === "no_verdict_available"
    ),
  };
}

const CLEAN_FIELDS = { blockersCount: 0, topPriorities: [] as never[] };
const MISLEADING_CLEAN = /nothing is blocking deploy|nothing i need you to fix|ship when you're ready/i;

describe("cross-tool decision consistency", () => {
  it("analysis_failed: safe_fix and production_history never claim clean; what_changed refuses", async () => {
    const verdict = buildVerdictFixture({ status: "analysis_failed", score: null, ...CLEAN_FIELDS });
    const { deploy, fix, history, whatChangedRefuses } = await runAllExceptWhatChanged(
      tables({ production_verdicts: [verdictRow(PROJECT, verdict)] })
    );

    expect(deploy.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
    expect(fix.status).toBe("no_actionable_finding");
    if (fix.status === "no_actionable_finding") {
      expect(fix.reason).toBe("insufficient_evidence");
      expect(fix.verdictStatus).toBe("analysis_failed");
    }
    expect(fix.summary).not.toMatch(MISLEADING_CLEAN);
    expect(history.currentVerdict).toBe("analysis_failed");
    expect(history.currentDecision).toBe("more_analysis_required");
    expect(whatChangedRefuses).toBe(true);
  });

  it.each(["insufficient_data"] as const)(
    "%s: no tool claims the project is clean, ready, or has nothing to fix",
    async (status) => {
      const verdict = buildVerdictFixture({ status, score: 100, ...CLEAN_FIELDS });
      const { deploy, fix, changed, history } = await runAll(
        tables({ production_verdicts: [verdictRow(PROJECT, verdict)] })
      );

      expect(deploy.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");

      expect(fix.status).toBe("no_actionable_finding");
      if (fix.status === "no_actionable_finding") {
        expect(fix.reason).toBe("insufficient_evidence");
        expect(fix.verdictStatus).toBe(status);
      }
      expect(fix.summary).not.toMatch(MISLEADING_CLEAN);

      expect(changed.currentDecision).toBe("more_analysis_required");
      expect(changed.authoritativeVerdictStatus).toBe(status);
      expect(changed.nextAction).not.toBe(t("actions.shipWhenReady"));
      expect(changed.summary).not.toMatch(MISLEADING_CLEAN);
      expect(changed.summary).toContain(t("whatChanged.notADeployAnswer"));

      expect(history.currentVerdict).toBe(status);
      expect(history.currentDecision).toBe("more_analysis_required");
      expect(history.currentVerdictSource).toBe("authoritative");
    }
  );

  it("not_ready with zero blockers: safe_fix does not say there is nothing to fix", async () => {
    const verdict = buildVerdictFixture({ status: "not_ready", score: 30, ...CLEAN_FIELDS });
    const { deploy, fix, changed } = await runAll(
      tables({ production_verdicts: [verdictRow(PROJECT, verdict)] })
    );
    expect(deploy.deploymentRecommendation).toBe("DO_NOT_DEPLOY");
    expect(fix.status).toBe("no_actionable_finding");
    if (fix.status === "no_actionable_finding") {
      expect(fix.reason).toBe("not_ready_without_specific_finding");
    }
    expect(fix.summary).not.toMatch(MISLEADING_CLEAN);
    expect(changed.currentDecision).toBe("do_not_deploy");
  });

  it("review running over a ready verdict: no tool tells an agent to ship or that nothing is left", async () => {
    const verdict = buildVerdictFixture({
      status: "ready_to_ship",
      score: 96,
      commitSha: "aaa1111",
      ...CLEAN_FIELDS,
    });
    const { deploy, fix, changed, history } = await runAll(
      tables({
        production_verdicts: [verdictRow(PROJECT, verdict)],
        repository_sync_status: [
          { project_id: PROJECT, commit_sha: "aaa1111", connection_status: "connected", last_error: null },
        ],
        repository_scan_state: [{ repository_id: PROJECT, last_commit_sha: "aaa1111", active_scan_id: "scan-99" }],
        scans: [
          { id: "scan-99", repository_id: PROJECT, status: "scanning", commit_sha: "bbb2222", created_at: "2026-03-02" },
        ],
      })
    );

    expect(deploy.reviewInProgress).toBe(true);
    expect(deploy.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");

    expect(fix.status).toBe("no_actionable_finding");
    if (fix.status === "no_actionable_finding") expect(fix.reason).toBe("review_in_progress");
    expect(fix.summary).not.toMatch(MISLEADING_CLEAN);

    expect(changed.reviewInProgress).toBe(true);
    expect(changed.currentDecision).toBe("more_analysis_required");
    expect(changed.nextAction).toBe(t("actions.waitForReview"));
    expect(changed.summary).not.toMatch(MISLEADING_CLEAN);

    expect(history.reviewInProgress).toBe(true);
    expect(history.currentDecision).toBe("more_analysis_required");
  });

  it("stale ready verdict: safe_fix and what_changed do not present it as current", async () => {
    const verdict = buildVerdictFixture({
      status: "ready_to_ship",
      score: 96,
      commitSha: "aaa1111",
      ...CLEAN_FIELDS,
    });
    const { fix, changed, history } = await runAll(
      tables({
        production_verdicts: [verdictRow(PROJECT, verdict)],
        repository_sync_status: [
          { project_id: PROJECT, commit_sha: "bbb2222", connection_status: "connected", last_error: null },
        ],
      })
    );

    expect(fix.status).toBe("no_actionable_finding");
    if (fix.status === "no_actionable_finding") expect(fix.reason).toBe("stale_or_unverified");
    expect(fix.summary).not.toMatch(MISLEADING_CLEAN);

    expect(changed.freshnessStatus).toBe("stale");
    expect(changed.nextAction).toBe(t("actions.reviewAgain"));
    expect(history.freshnessStatus).toBe("stale");
  });

  it("failed automatic review: safe_fix and what_changed do not imply clean evidence", async () => {
    const verdict = buildVerdictFixture({
      status: "ready_to_ship",
      score: 96,
      commitSha: "aaa1111",
      ...CLEAN_FIELDS,
    });
    const { deploy, fix, changed } = await runAll(
      tables({
        production_verdicts: [verdictRow(PROJECT, verdict)],
        repository_sync_status: [
          { project_id: PROJECT, commit_sha: "aaa1111", connection_status: "connected", last_error: null },
        ],
        scans: [
          {
            repository_id: PROJECT,
            review_type: "automatic",
            status: "failed",
            commit_sha: "ccc3333",
            created_at: "2026-02-01",
          },
        ],
      })
    );

    expect(deploy.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
    expect(fix.status).toBe("no_actionable_finding");
    if (fix.status === "no_actionable_finding") expect(fix.reason).toBe("review_failed");
    expect(changed.nextAction).not.toBe(t("actions.shipWhenReady"));
    expect(changed.currentDecision).toBe("more_analysis_required");
  });

  it("genuinely ready and current: tools agree it is shippable and nothing needs fixing", async () => {
    const verdict = buildVerdictFixture({ status: "ready_to_ship", score: 96, ...CLEAN_FIELDS });
    const { deploy, fix, changed, history } = await runAll(
      tables({ production_verdicts: [verdictRow(PROJECT, verdict)] })
    );

    expect(deploy.deploymentRecommendation).toBe("SHIP_IT");
    expect(fix.status).toBe("no_blockers");
    expect(changed.currentDecision).toBe("deploy");
    expect(changed.nextAction).toBe(t("actions.shipWhenReady"));
    expect(history.currentDecision).toBe("deploy");
  });

  it("production_history current verdict follows the authoritative pointer, not the newest history row", async () => {
    // The newest row in history is ready_to_ship, but the project's current
    // verdict pointer (what can_i_deploy uses) is an older insufficient_data
    // row. History must never silently promote itself to "current".
    const olderInsufficient = buildVerdictFixture({
      status: "insufficient_data",
      score: 100,
      scanId: "44444444-4444-4444-8444-444444444441",
      generatedAt: "2026-03-01T00:00:00.000Z",
      ...CLEAN_FIELDS,
    });
    const newerReady = buildVerdictFixture({
      status: "ready_to_ship",
      score: 96,
      scanId: "44444444-4444-4444-8444-444444444442",
      generatedAt: "2026-03-05T00:00:00.000Z",
      ...CLEAN_FIELDS,
    });
    const olderRow = verdictRow(PROJECT, olderInsufficient);
    const newerRow = verdictRow(PROJECT, newerReady);

    const admin = createFakeAdmin(
      tables({
        production_verdicts: [olderRow, newerRow],
        repository_scan_state: [
          { repository_id: PROJECT, organization_id: ORG, current_verdict_id: olderRow.id, active_scan_id: null },
        ],
      })
    );
    const c = ctx(admin);
    const deploy = await canIDeploy(c, {}, t);
    const history = await productionHistory(c, {}, t);

    expect(deploy.verdictStatus).toBe("insufficient_data");
    expect(history.currentVerdict).toBe(deploy.verdictStatus);
    expect(history.currentVerdictScanId).toBe(olderInsufficient.scanId);
    expect(history.currentDecision).toBe("more_analysis_required");
  });
});

// Pass 3 CRIT-006: a priority that disappears is only "no longer detected"
// when the latest review had enough evidence to see it.
describe("what_changed never reports resolved blockers from an incomplete review", () => {
  function twoReviews(currentStatus: "insufficient_data" | "ready_to_ship") {
    const previous = buildVerdictFixture({
      status: "not_ready",
      score: 50,
      scanId: "44444444-4444-4444-8444-444444444441",
      generatedAt: "2026-03-01T00:00:00.000Z",
    });
    const current = buildVerdictFixture({
      status: currentStatus,
      score: 90,
      scanId: "44444444-4444-4444-8444-444444444442",
      generatedAt: "2026-03-05T00:00:00.000Z",
      blockersCount: 0,
      topPriorities: [] as never[],
    });
    return tables({ production_verdicts: [verdictRow(PROJECT, previous), verdictRow(PROJECT, current)] });
  }

  it("insufficient_data latest review: nothing is reported as resolved", async () => {
    const changed = await whatChanged(ctx(createFakeAdmin(twoReviews("insufficient_data"))), {}, t);
    expect(changed.resolvedBlockers).toEqual([]);
    expect(changed.improvements.filter((item) => !item.includes("pts"))).toEqual([]);
  });

  it("complete latest review: priorities that are gone are reported as no longer detected", async () => {
    const changed = await whatChanged(ctx(createFakeAdmin(twoReviews("ready_to_ship"))), {}, t);
    expect(changed.resolvedBlockers.length).toBeGreaterThan(0);
  });
});

// Pass 3 Part 8: SequrAI has no persisted Security Proof lifecycle, so no
// user-facing copy may claim one exists.
describe("no unsupported Security Proof claims in user-facing copy", () => {
  it("MCP message catalogs never promise a proof, certificate, or verified-fix guarantee", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const forbidden = /security proof|proof of (fix|remediation|security)|comprobante de (seguridad|correcci[oó]n)|certificado de seguridad|prueba de correcci[oó]n|verified fix|fix verified|correcci[oó]n verificada/i;
    for (const locale of ["en", "es"]) {
      const dir = join(process.cwd(), "messages", locale);
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
        const text = readFileSync(join(dir, file), "utf8");
        expect({ locale, file, match: text.match(forbidden)?.[0] ?? null }).toEqual({
          locale,
          file,
          match: null,
        });
      }
    }
  });
});
