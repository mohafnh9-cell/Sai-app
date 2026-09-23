import { describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

vi.mock("@/server/review-recovery/stale-review", async () => ({
  expireStaleActiveReviewsForRepository: async () => undefined,
  isStaleActiveReviewScan: () => false,
  REVIEW_STALE_FAILURE_CODE: "review_stale",
}));

import { pollUntilReviewTerminal } from "../poll";

// Phase Z v2 Pass 3 (CRIT-003): waiting for scan A must stay bound to scan A.
// A different scan of the same project reaching a terminal state must never
// satisfy the wait, or full_product_audit would present another review's
// evidence as the one it asked for.

const ORG = "66666666-6666-4666-8666-666666666666";
const PROJECT = "55555555-5555-4555-8555-555555555555";
const OTHER_PROJECT = "77777777-7777-4777-8777-777777777777";
const SCAN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCAN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function admin(scans: FakeTables["scans"]) {
  return createFakeAdmin({ scans, scan_jobs: [], repository_scan_state: [] } as FakeTables) as never;
}

const fast = { maxMs: 40, intervalMs: 5 };

describe("pollUntilReviewTerminal bound to a scan id", () => {
  it("A: scan B completing does not complete a wait on scan A that is still running", async () => {
    const result = await pollUntilReviewTerminal(
      admin([
        { id: SCAN_A, repository_id: PROJECT, status: "scanning", created_at: "2026-03-01" },
        { id: SCAN_B, repository_id: PROJECT, status: "completed", created_at: "2026-03-02" },
      ]),
      { organizationId: ORG, projectId: PROJECT, scanId: SCAN_A },
      fast
    );

    expect(result.timedOut).toBe(true);
    expect(result.scanId).toBe(SCAN_A);
    expect(result.status).toBe("scanning");
    expect(result.scanId).not.toBe(SCAN_B);
  });

  it("B: scan A reaching terminal completes the wait with A's own id and status", async () => {
    const result = await pollUntilReviewTerminal(
      admin([{ id: SCAN_A, repository_id: PROJECT, status: "completed", created_at: "2026-03-01" }]),
      { organizationId: ORG, projectId: PROJECT, scanId: SCAN_A },
      fast
    );
    expect(result).toEqual({ scanId: SCAN_A, status: "completed", timedOut: false });
  });

  it("C: a cancelled scan A is reported as cancelled even though scan B completed", async () => {
    const result = await pollUntilReviewTerminal(
      admin([
        { id: SCAN_A, repository_id: PROJECT, status: "cancelled", created_at: "2026-03-01" },
        { id: SCAN_B, repository_id: PROJECT, status: "completed", created_at: "2026-03-02" },
      ]),
      { organizationId: ORG, projectId: PROJECT, scanId: SCAN_A },
      fast
    );
    expect(result.status).toBe("cancelled");
    expect(result.scanId).toBe(SCAN_A);
    expect(result.timedOut).toBe(false);
  });

  it("C2: a failed scan A is reported as failed even though scan B completed", async () => {
    const result = await pollUntilReviewTerminal(
      admin([
        { id: SCAN_A, repository_id: PROJECT, status: "failed", created_at: "2026-03-01" },
        { id: SCAN_B, repository_id: PROJECT, status: "completed", created_at: "2026-03-02" },
      ]),
      { organizationId: ORG, projectId: PROJECT, scanId: SCAN_A },
      fast
    );
    expect(result.status).toBe("failed");
    expect(result.scanId).toBe(SCAN_A);
  });

  it("D: an unknown scan id fails safe as missing and is never substituted", async () => {
    const result = await pollUntilReviewTerminal(
      admin([{ id: SCAN_B, repository_id: PROJECT, status: "completed", created_at: "2026-03-02" }]),
      { organizationId: ORG, projectId: PROJECT, scanId: SCAN_A },
      fast
    );
    expect(result).toEqual({ scanId: null, status: "missing", timedOut: false });
  });

  it("E: a scan that belongs to a different project fails safe as missing", async () => {
    const result = await pollUntilReviewTerminal(
      admin([{ id: SCAN_A, repository_id: OTHER_PROJECT, status: "completed", created_at: "2026-03-01" }]),
      { organizationId: ORG, projectId: PROJECT, scanId: SCAN_A },
      fast
    );
    expect(result).toEqual({ scanId: null, status: "missing", timedOut: false });
  });
});
