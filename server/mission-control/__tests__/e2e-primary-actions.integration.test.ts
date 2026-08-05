/**
 * End-to-end verification for Mission Control primary actions.
 * Run with Node 22+: PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH" npm test -- server/mission-control/__tests__/e2e-primary-actions.integration.test.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

config({ path: resolve(process.cwd(), ".env.local"), override: true });
config({ path: resolve(process.cwd(), ".env"), override: true });

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "2bd1e005-56c8-4aef-9c72-ed1d444467ed";
const POLL_MS = 3000;
const SCAN_TIMEOUT_MS = 180_000;
const SECURITY_TIMEOUT_MS = 120_000;

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function loadProjectContext(admin: Awaited<
  ReturnType<(typeof import("@/server/security-scanner/admin-client"))["createAdminClient"]>
>) {
  const { data: project } = await admin
    .from("projects")
    .select("id, organization_id, github_repo, name")
    .eq("id", PROJECT_ID)
    .maybeSingle();

  expect(project?.github_repo, "Need a project with github_repo").toBeTruthy();

  const { data: member } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", project!.organization_id)
    .limit(1)
    .maybeSingle();

  expect(member?.user_id, "Need organization member for triggered_by_user_id").toBeTruthy();

  return {
    project: {
      id: project!.id as string,
      organization_id: project!.organization_id as string,
      github_repo: project!.github_repo as string,
    },
    userId: member!.user_id as string,
  };
}

describe("Mission Control primary actions E2E", () => {
  it(
    "scan flow: POST analysis → scan + job + worker + verdict",
    async () => {
      const { createAdminClient } = await import("@/server/security-scanner/admin-client");
      const { startRepositoryManualScan } = await import(
        "@/server/security-scanner/start-repository-manual-scan"
      );

      const admin = createAdminClient();
      const { project, userId } = await loadProjectContext(admin);

      const result = await startRepositoryManualScan(
        {
          supabase: admin,
          admin,
          user: { id: userId },
          project,
        },
        { repositoryId: project.id, scanType: "full", forceNew: true }
      );

      expect(["scheduled", "resumed", "in_progress", "reused"]).toContain(result.outcome);

      const scanId =
        result.outcome === "in_progress"
          ? ((result.scan as { id?: string })?.id ?? null)
          : "scanId" in result
            ? result.scanId
            : null;

      expect(scanId, `startRepositoryManualScan outcome=${result.outcome}`).toBeTruthy();

      console.log("✓ HTTP equivalent: POST /api/projects/{id}/analysis-runs");
      console.log("  Response outcome:", result.outcome);
      console.log("  scanId:", scanId);
      if (result.outcome === "scheduled") {
        console.log("  scanJobId:", result.scanJobId);
        console.log("  commitSha:", result.commitSha);
      }

      const { data: scanRow } = await admin
        .from("scans")
        .select("id, status, commit_sha, progress, progress_message, scan_job_id")
        .eq("id", scanId!)
        .maybeSingle();
      expect(scanRow).toBeTruthy();
      console.log("✓ Scan row created:", scanRow!.id, "status:", scanRow!.status);

      const jobId =
        result.outcome === "scheduled"
          ? result.scanJobId
          : (scanRow!.scan_job_id as string | null);
      if (jobId) {
        const { data: jobRow } = await admin
          .from("scan_jobs")
          .select("id, status, scheduler")
          .eq("id", jobId)
          .maybeSingle();
        expect(jobRow).toBeTruthy();
        console.log(
          "✓ Scan job created:",
          jobRow!.id,
          "status:",
          jobRow!.status,
          "scheduler:",
          jobRow!.scheduler
        );
      }

      const startedAt = Date.now();
      let lastProgress: { progress: number | null; message: string | null; status: string } | null =
        null;
      let finalScan = scanRow;

      while (Date.now() - startedAt < SCAN_TIMEOUT_MS) {
        const { data: current } = await admin
          .from("scans")
          .select("id, status, progress, progress_message, commit_sha, completed_at")
          .eq("id", scanId!)
          .maybeSingle();

        if (!current) break;
        finalScan = current;
        lastProgress = {
          progress: (current.progress as number | null) ?? null,
          message: (current.progress_message as string | null) ?? null,
          status: String(current.status),
        };

        if (current.status === "completed" || current.status === "failed") break;
        await sleep(POLL_MS);
      }

      console.log("✓ Progress updated:", lastProgress);
      expect(finalScan?.status).toBe("completed");

      const { data: verdictRow } = await admin
        .from("production_verdicts")
        .select("id, scan_id, verdict")
        .eq("scan_id", scanId!)
        .maybeSingle();

      expect(verdictRow, "production_verdicts row for scan").toBeTruthy();
      const verdict = verdictRow!.verdict as { generatedAt?: string; commitSha?: string } | null;
      console.log("✓ Production Verdict generated:");
      console.log("  productionVerdictId:", verdictRow!.id);
      console.log("  scanId:", verdictRow!.scan_id);
      console.log("  commitSha:", verdict?.commitSha ?? finalScan?.commit_sha);
      console.log("  generatedAt:", verdict?.generatedAt);
    },
    SCAN_TIMEOUT_MS + 30_000
  );

  it(
    "security test flow: POST security-tests → campaign + executions",
    async () => {
      const { createAdminClient } = await import("@/server/security-scanner/admin-client");
      const { startAttackCampaign } = await import(
        "@/server/attack-simulation/start-attack-campaign"
      );
      const { mapSelectedTestsToHypotheses } = await import(
        "@/server/attack-simulation/security-test-options"
      );
      const { DEFAULT_SECURITY_TEST_IDS } = await import(
        "@/features/security-testing/user-test-catalog"
      );

      const admin = createAdminClient();
      const { project } = await loadProjectContext(admin);

      const { data: latestScan } = await admin
        .from("scans")
        .select("id, commit_sha, status")
        .eq("project_id", project.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      expect(latestScan?.id, "needs completed scan — run scan test first").toBeTruthy();

      const { data: latestJob } = await admin
        .from("scan_jobs")
        .select("id")
        .eq("scan_id", latestScan!.id)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const mockT = ((key: string) => key) as import("@/lib/i18n/types").Translator;
      const hypotheses = mapSelectedTestsToHypotheses(
        [...DEFAULT_SECURITY_TEST_IDS].slice(0, 4),
        [],
        mockT
      );
      expect(hypotheses.length).toBeGreaterThan(0);

      console.log("✓ Latest completed scan:", latestScan!.id);

      const result = await startAttackCampaign(admin, {
        projectId: project.id,
        organizationId: project.organization_id,
        body: {
          scanId: latestScan!.id as string,
          scanJobId: (latestJob?.id as string | null) ?? null,
          commitSha: latestScan!.commit_sha as string,
          runtimeMode: "mock",
          hypotheses,
        },
      });

      console.log("✓ HTTP equivalent: POST /api/projects/{id}/security-tests");
      console.log("  campaignId:", result.campaignId);
      console.log("  executionIds:", result.executionIds);

      expect(result.campaignId).toBeTruthy();
      expect(result.executionIds.length).toBeGreaterThan(0);

      const { data: campaign } = await admin
        .from("attack_simulation_campaigns")
        .select("id, status, scan_id, commit_sha")
        .eq("id", result.campaignId)
        .maybeSingle();
      expect(campaign).toBeTruthy();
      console.log("✓ Campaign row:", campaign!.id, "status:", campaign!.status);

      const startedAt = Date.now();
      let executions: Array<{ id: string; status: string }> = [];

      while (Date.now() - startedAt < SECURITY_TIMEOUT_MS) {
        const { data: rows } = await admin
          .from("attack_simulation_executions")
          .select("id, status")
          .eq("campaign_id", result.campaignId);

        executions = (rows ?? []) as Array<{ id: string; status: string }>;
        const terminal = new Set([
          "protected",
          "not_exploitable",
          "blocked",
          "completed",
          "failed",
          "cancelled",
          "still_vulnerable",
          "confirmed",
          "fix_ready",
        ]);
        const allTerminal = executions.every((row) => terminal.has(row.status));
        if (executions.length > 0 && allTerminal) break;
        await sleep(POLL_MS);
      }

      console.log("✓ Security executions:");
      for (const exec of executions) {
        console.log("  securityExecutionId:", exec.id, "status:", exec.status);
      }
      expect(executions.length).toBeGreaterThan(0);
    },
    SECURITY_TIMEOUT_MS + 30_000
  );
});
