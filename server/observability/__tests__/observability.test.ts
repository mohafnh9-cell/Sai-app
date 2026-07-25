import { describe, expect, it } from "vitest";
import { sanitizeOperationalFields } from "../sanitize";
import { incrementMetricCounter, getMetricCounters, percentileSummary, resetMetricCountersForTests } from "../metrics";
import { buildIdempotencyKey } from "../idempotency";

describe("operational sanitize", () => {
  it("removes forbidden keys from operational payloads", () => {
    const safe = sanitizeOperationalFields({
      scanJobId: "job-1",
      providerToken: "secret",
      webhookPayload: { repository: { id: 1 } },
    });
    expect(safe).toEqual({ scanJobId: "job-1" });
  });
});

describe("metrics", () => {
  it("computes p50/p95/p99", () => {
    const summary = percentileSummary([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(summary.p50).toBe(500);
    expect(summary.p95).toBe(1000);
    expect(summary.p99).toBe(1000);
  });

  it("increments counters", () => {
    resetMetricCountersForTests();
    incrementMetricCounter("jobs_created_total", 2);
    incrementMetricCounter("jobs_failed_total");
    expect(getMetricCounters().jobs_created_total).toBe(2);
    expect(getMetricCounters().jobs_failed_total).toBe(1);
  });
});

describe("idempotency keys", () => {
  it("builds deterministic keys", () => {
    const a = buildIdempotencyKey({
      organizationId: "org",
      projectId: "proj",
      scanId: "scan",
      commitSha: "abc",
      operationType: "production_verdict",
    });
    const b = buildIdempotencyKey({
      organizationId: "org",
      projectId: "proj",
      scanId: "scan",
      commitSha: "abc",
      operationType: "production_verdict",
    });
    expect(a).toBe(b);
  });
});
