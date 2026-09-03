import { describe, expect, it } from "vitest";
import {
  getScannerResultDetail,
  listScannerResultsForOrganization,
} from "../list-scanner-results";

function adminStub(input: {
  scans: unknown[];
  projects?: unknown[];
  verdicts?: unknown[];
  scanJob?: unknown | null;
}) {
  return {
    from: (table: string) => {
      if (table === "scans") {
        return {
          select: () => ({
            eq: (...args: unknown[]) => {
              // list path: .eq("organization_id", ...).order().limit()
              // detail path: .eq("id", ...).eq("organization_id", ...).maybeSingle()
              const chain = {
                eq: () => chain,
                order: () => ({
                  limit: async () => ({ data: input.scans, error: null }),
                }),
                maybeSingle: async () => ({ data: input.scans[0] ?? null, error: null }),
              };
              void args;
              return chain;
            },
          }),
        };
      }
      if (table === "projects") {
        return {
          select: () => ({
            in: async () => ({ data: input.projects ?? [], error: null }),
            eq: () => ({
              maybeSingle: async () => ({ data: (input.projects ?? [])[0] ?? null }),
            }),
          }),
        };
      }
      if (table === "production_verdicts") {
        return {
          select: () => ({
            in: async () => ({ data: input.verdicts ?? [], error: null }),
            eq: () => ({
              maybeSingle: async () => ({ data: (input.verdicts ?? [])[0] ?? null }),
            }),
          }),
        };
      }
      if (table === "scan_jobs") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: input.scanJob ?? null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe("listScannerResultsForOrganization", () => {
  it("prefers wall-clock duration over the scanner's internal metrics.durationMs", async () => {
    const admin = adminStub({
      scans: [
        {
          id: "scan-1",
          project_id: "proj-1",
          status: "completed",
          scan_type: "full",
          branch: "main",
          commit_sha: "abc1234567890",
          created_at: "2026-02-02T00:00:00Z",
          completed_at: "2026-02-02T00:00:03Z",
          started_at: "2026-02-02T00:00:00Z",
          files_analyzed: 10,
          findings_count: 5,
          critical_count: 1,
          high_count: 0,
          medium_count: 4,
          error_message: null,
          metrics: { durationMs: 50 },
        },
      ],
      projects: [{ id: "proj-1", name: "demo-app" }],
      verdicts: [{ scan_id: "scan-1" }],
    });

    const results = await listScannerResultsForOrganization(admin, { organizationId: "org-1" });

    expect(results).toHaveLength(1);
    expect(results[0]?.durationMs).toBe(3000);
    expect(results[0]?.projectName).toBe("demo-app");
    expect(results[0]?.hasVerdict).toBe(true);
  });

  it("does not fabricate a duration when neither timestamps nor metrics exist", async () => {
    const admin = adminStub({
      scans: [
        {
          id: "scan-2",
          project_id: "proj-1",
          status: "failed",
          scan_type: "full",
          branch: null,
          commit_sha: null,
          created_at: "2026-02-02T00:00:00Z",
          completed_at: null,
          started_at: null,
          files_analyzed: 0,
          findings_count: 0,
          critical_count: 0,
          high_count: 0,
          medium_count: 0,
          error_message: "Review remained queued beyond the allowed window",
          metrics: null,
        },
      ],
      projects: [{ id: "proj-1", name: "demo-app" }],
      verdicts: [],
    });

    const results = await listScannerResultsForOrganization(admin, { organizationId: "org-1" });

    expect(results[0]?.durationMs).toBeNull();
    expect(results[0]?.hasVerdict).toBe(false);
    expect(results[0]?.errorMessage).toBe("Review remained queued beyond the allowed window");
  });

  it("returns an empty list rather than throwing when the organization has no scans", async () => {
    const admin = adminStub({ scans: [] });
    const results = await listScannerResultsForOrganization(admin, { organizationId: "org-empty" });
    expect(results).toEqual([]);
  });
});

describe("getScannerResultDetail", () => {
  it("returns null (fail closed) when the scan does not belong to the requested organization", async () => {
    const admin = adminStub({ scans: [] });
    const detail = await getScannerResultDetail(admin, {
      organizationId: "org-1",
      scanId: "scan-in-another-org",
    });
    expect(detail).toBeNull();
  });

  it("surfaces the execution trace stages when present", async () => {
    const admin = adminStub({
      scans: [
        {
          id: "scan-3",
          project_id: "proj-1",
          status: "completed",
          scan_type: "incremental",
          branch: "main",
          commit_sha: "abc1234567890",
          created_at: "2026-02-02T00:00:00Z",
          completed_at: "2026-02-02T00:00:05Z",
          started_at: "2026-02-02T00:00:00Z",
          files_analyzed: 3,
          findings_count: 1,
          critical_count: 0,
          high_count: 1,
          medium_count: 0,
          error_message: null,
          metrics: null,
        },
      ],
      projects: [{ id: "proj-1", name: "demo-app" }],
      verdicts: [{ scan_id: "scan-3" }],
      scanJob: {
        metadata: {
          executionTrace: {
            stages: [
              { stage: "scan_started", at: "2026-02-02T00:00:00Z" },
              { stage: "repository_fetched", at: "2026-02-02T00:00:01Z" },
            ],
          },
        },
      },
    });

    const detail = await getScannerResultDetail(admin, { organizationId: "org-1", scanId: "scan-3" });

    expect(detail?.executionTrace).toHaveLength(2);
    expect(detail?.executionTrace[1]?.stage).toBe("repository_fetched");
  });
});
