import { describe, expect, it } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { assertScanContinues, ScanCancelledError } from "../review-abort";

const SCAN_ID = "scan-1";

function adminWithScanStatus(status: string | null) {
  const t: FakeTables = { scans: status === null ? [] : [{ id: SCAN_ID, status }] };
  return createFakeAdmin(t);
}

describe("assertScanContinues", () => {
  it("does NOT throw for 'completed' -- Phase 41 regression: the native scan phase (scan-job-runner.ts) deliberately marks the scan completed and then keeps running its own enrichment phase (Security Orchestrator / red-team / Production Verdict) in the same request; treating 'completed' as a cancellation signal here silently skipped that entire phase for every real review", async () => {
    const admin = adminWithScanStatus("completed");
    await expect(assertScanContinues(admin as never, SCAN_ID)).resolves.toBeUndefined();
  });

  it("throws for 'cancelled'", async () => {
    const admin = adminWithScanStatus("cancelled");
    await expect(assertScanContinues(admin as never, SCAN_ID)).rejects.toBeInstanceOf(ScanCancelledError);
  });

  it("throws for 'cancelling'", async () => {
    const admin = adminWithScanStatus("cancelling");
    await expect(assertScanContinues(admin as never, SCAN_ID)).rejects.toBeInstanceOf(ScanCancelledError);
  });

  it("throws for 'failed' -- a failed native scan must not continue into enrichment", async () => {
    const admin = adminWithScanStatus("failed");
    await expect(assertScanContinues(admin as never, SCAN_ID)).rejects.toBeInstanceOf(ScanCancelledError);
  });

  it("does not throw for the active processing statuses", async () => {
    for (const status of ["queued", "fetching_repository", "indexing", "scanning", "calculating_score"]) {
      const admin = adminWithScanStatus(status);
      await expect(assertScanContinues(admin as never, SCAN_ID)).resolves.toBeUndefined();
    }
  });

  it("does not throw when the scan row cannot be found (no status to check)", async () => {
    const admin = adminWithScanStatus(null);
    await expect(assertScanContinues(admin as never, SCAN_ID)).resolves.toBeUndefined();
  });
});
