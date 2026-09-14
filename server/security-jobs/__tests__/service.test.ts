import { describe, expect, it } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { claimNextSecurityJob, createSecurityJob, requestSecurityJobCancellation, transitionSecurityJob } from "../service";
import { InvalidJobTransitionError } from "../state-machine";

const ORG_A = "org-a";
const ORG_B = "org-b";
const PROJECT_A = "project-a";
const SCAN_A = "scan-a";

function tables(): FakeTables {
  return { security_jobs: [], security_job_events: [], subscriptions: [], profiles: [] };
}

describe("Phase 35.5 -- createSecurityJob", () => {
  it("does NOT re-run billing (section 29: a job is a sub-execution of an already-billed scan, not a new billable operation)", async () => {
    // No subscriptions row, no billing-enabled env stub -- if this function
    // called assertOrganizationCanRunScan a second time with billing
    // enabled it would either throw or silently consume a second free
    // credit. It does neither: job creation succeeds unconditionally.
    const t = tables();
    const admin = createFakeAdmin(t);
    const job = await createSecurityJob(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: SCAN_A,
      engine: "opengrep",
      engineVersion: "1.30.0",
      capabilities: ["taint"],
    });
    expect(job.status).toBe("QUEUED");
    expect(t.subscriptions).toHaveLength(0); // no free-credit consumption happened
  });

  it("is idempotent: a duplicate call for the same (scan, engine) returns the existing in-flight job, not a second row", async () => {
    const t = tables();
    const admin = createFakeAdmin(t);
    const first = await createSecurityJob(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: SCAN_A,
      engine: "trivy",
      engineVersion: "0.74.0",
      capabilities: [],
    });
    const second = await createSecurityJob(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: SCAN_A,
      engine: "trivy",
      engineVersion: "0.74.0",
      capabilities: [],
    });
    expect(second.id).toBe(first.id);
    expect(t.security_jobs).toHaveLength(1);
  });

  it("scopes every job to its organization/project/scan -- tenant isolation (section 30/36)", async () => {
    const t = tables();
    const admin = createFakeAdmin(t);
    await createSecurityJob(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: SCAN_A,
      engine: "crypto",
      engineVersion: "1.0.0",
      capabilities: [],
    });
    const orgBRows = (t.security_jobs ?? []).filter((r) => r.organization_id === ORG_B);
    expect(orgBRows).toHaveLength(0);
    expect(t.security_jobs?.[0]).toMatchObject({ organization_id: ORG_A, project_id: PROJECT_A, scan_id: SCAN_A });
  });
});

describe("Phase 35.5 -- claimNextSecurityJob", () => {
  it("claims the oldest QUEUED job and flips it to RUNNING, never re-claiming the same row", async () => {
    const t = tables();
    const admin = createFakeAdmin(t);
    await createSecurityJob(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: SCAN_A,
      engine: "opengrep",
      engineVersion: "1.30.0",
      capabilities: [],
    });

    const claimed = await claimNextSecurityJob(admin as never, "worker-1");
    expect(claimed?.status).toBe("RUNNING");
    expect(claimed?.claimedBy).toBe("worker-1");

    const secondClaim = await claimNextSecurityJob(admin as never, "worker-2");
    expect(secondClaim).toBeNull(); // nothing left QUEUED
  });
});

describe("Phase 35.5 -- transitionSecurityJob", () => {
  it("rejects an invalid transition instead of writing it", async () => {
    const t = tables();
    const admin = createFakeAdmin(t);
    await expect(transitionSecurityJob(admin as never, { jobId: "j1", from: "COMPLETED", to: "RUNNING" })).rejects.toThrow(
      InvalidJobTransitionError
    );
  });
});

describe("Phase 35.5 -- requestSecurityJobCancellation", () => {
  it("sets cancel_requested without itself claiming the job actually stopped (section 14)", async () => {
    const t = tables();
    const admin = createFakeAdmin(t);
    const job = await createSecurityJob(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: SCAN_A,
      engine: "trivy",
      engineVersion: "0.74.0",
      capabilities: [],
    });

    await requestSecurityJobCancellation(admin as never, { organizationId: ORG_A, jobId: job.id });

    const row = t.security_jobs?.find((r) => r.id === job.id);
    expect(row?.cancel_requested).toBe(true);
    expect(row?.status).toBe("QUEUED"); // status itself is untouched -- only the worker transitions to CANCELLED once it has actually stopped
  });

  it("cannot cancel a job belonging to a different organization", async () => {
    const t = tables();
    const admin = createFakeAdmin(t);
    const job = await createSecurityJob(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: SCAN_A,
      engine: "trivy",
      engineVersion: "0.74.0",
      capabilities: [],
    });

    await requestSecurityJobCancellation(admin as never, { organizationId: ORG_B, jobId: job.id });

    const row = t.security_jobs?.find((r) => r.id === job.id);
    expect(row?.cancel_requested).toBe(false);
  });
});
