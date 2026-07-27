import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  CancelProductionReviewError,
  cancelProductionReview,
} from "../cancel-production-review";

vi.mock("@/server/jobs/scan-job-store", () => ({
  markScanJobCancelled: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/observability/operational-events", () => ({
  emitOperationalEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/jobs/scan-execution/scan-execution-trace", () => ({
  logScanExecutionTrace: vi.fn(),
}));

type ScanState = {
  id: string;
  status: string;
  organization_id: string;
  project_id: string;
  repository_id: string;
  progress: number;
  progress_message: string | null;
};

function buildAdmin(initial: ScanState, jobStatus: "queued" | "running" | null = "running") {
  let scan = { ...initial };
  const events: Record<string, unknown>[] = [];

  const admin = {
    from: (table: string) => {
      if (table === "scans") {
        return {
          select: () => ({
            eq: (_c: string, _v: string) => ({
              eq: (_c2: string, _v2: string) => ({
                maybeSingle: async () => ({ data: scan, error: null }),
              }),
              maybeSingle: async () => ({ data: scan, error: null }),
            }),
          }),
          update: (values: Record<string, unknown>) => ({
            eq: () => ({
              eq: () => ({
                in: (_col: string, statuses: string[]) => ({
                  select: () => ({
                    maybeSingle: async () => {
                      if (!statuses.includes(scan.status)) {
                        return { data: null, error: null };
                      }
                      scan = { ...scan, ...values, status: values.status as string };
                      return { data: { id: scan.id }, error: null };
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "scan_jobs") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () =>
                      jobStatus
                        ? { data: { id: "job-1" }, error: null }
                        : { data: null, error: null },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "repository_scan_state") {
        return {
          update: () => ({
            eq: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "scan_job_events") {
        return {
          insert: (row: Record<string, unknown>) => {
            events.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    _scan: () => scan,
    _events: () => events,
  };
  return admin;
}

const baseScan: ScanState = {
  id: "review-1",
  status: "queued",
  organization_id: "org-1",
  project_id: "project-1",
  repository_id: "project-1",
  progress: 0,
  progress_message: "Queued",
};

describe("cancelProductionReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels a queued review", async () => {
    const admin = buildAdmin(baseScan);
    const result = await cancelProductionReview(admin as never, {
      reviewId: "review-1",
      projectId: "project-1",
      cancelledByUserId: "user-1",
    });
    expect(result.cancelled).toBe(true);
    expect(admin._scan().status).toBe("cancelled");
    expect(admin._scan().cancellation_reason).toBe("USER_CANCELLED");
  });

  it("cancels a running review (scanning)", async () => {
    const admin = buildAdmin({
      ...baseScan,
      status: "scanning",
      progress: 62,
      progress_message: "RT9 Business Logic",
    });
    const result = await cancelProductionReview(admin as never, {
      reviewId: "review-1",
      projectId: "project-1",
      cancelledByUserId: "user-1",
    });
    expect(result.cancelled).toBe(true);
    expect(admin._scan().progress_at_cancellation).toBe(62);
    expect(admin._scan().last_completed_phase).toBe("RT9 Business Logic");
  });

  it("rejects review not found", async () => {
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    };
    await expect(
      cancelProductionReview(admin as never, {
        reviewId: "missing",
        projectId: "project-1",
      })
    ).rejects.toMatchObject({ code: "SCAN_NOT_FOUND" });
  });

  it("rejects already cancelled as idempotent success", async () => {
    const admin = buildAdmin({ ...baseScan, status: "cancelled" });
    const result = await cancelProductionReview(admin as never, {
      reviewId: "review-1",
      projectId: "project-1",
    });
    expect(result.cancelled).toBe(true);
    expect(result.idempotent).toBe(true);
  });

  it("rejects already completed review", async () => {
    const admin = buildAdmin({ ...baseScan, status: "completed" });
    await expect(
      cancelProductionReview(admin as never, {
        reviewId: "review-1",
        projectId: "project-1",
      })
    ).rejects.toBeInstanceOf(CancelProductionReviewError);
  });

  it("handles duplicate cancellation requests", async () => {
    const admin = buildAdmin({ ...baseScan, status: "scanning", progress: 40 });
    const first = await cancelProductionReview(admin as never, {
      reviewId: "review-1",
      projectId: "project-1",
      cancelledByUserId: "user-1",
    });
    const second = await cancelProductionReview(admin as never, {
      reviewId: "review-1",
      projectId: "project-1",
      cancelledByUserId: "user-1",
    });
    expect(first.cancelled).toBe(true);
    expect(second.idempotent).toBe(true);
  });

  it("cancels during calculating_score (decision / verdict phase)", async () => {
    const admin = buildAdmin({
      ...baseScan,
      status: "calculating_score",
      progress: 92,
      progress_message: "Decision Engine",
    });
    const result = await cancelProductionReview(admin as never, {
      reviewId: "review-1",
      projectId: "project-1",
    });
    expect(result.cancelled).toBe(true);
    expect(admin._scan().last_completed_phase).toBe("Decision Engine");
  });
});

describe("cancellation eligibility", () => {
  it("maps active pipeline phases to cancellable", async () => {
    const { isCancellableScanStatus } = await import("@/lib/review/cancellation");
    expect(isCancellableScanStatus("calculating_score")).toBe(true);
    expect(isCancellableScanStatus("completed")).toBe(false);
    expect(isCancellableScanStatus("cancelled")).toBe(false);
  });
});
