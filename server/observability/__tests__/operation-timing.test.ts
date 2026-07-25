import { describe, expect, it } from "vitest";
import {
  getOperationTimingSummaries,
  recordOperationDuration,
  resetOperationTimingsForTests,
  withOperationTiming,
} from "../operation-timing";

describe("operation timing", () => {
  it("records p50/p95/p99 samples", async () => {
    resetOperationTimingsForTests();
    for (let i = 1; i <= 10; i++) {
      recordOperationDuration("api.production_memory", i * 10);
    }
    const summary = getOperationTimingSummaries()["api.production_memory"];
    expect(summary.count).toBe(10);
    expect(summary.p50).toBe(50);
  });

  it("wraps async work", async () => {
    resetOperationTimingsForTests();
    await withOperationTiming("safe_fix.generate", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 1;
    });
    expect(getOperationTimingSummaries()["safe_fix.generate"].count).toBe(1);
  });
});
