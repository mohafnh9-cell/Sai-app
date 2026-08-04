import { describe, expect, it } from "vitest";
import {
  mapStartScanResultToAnalysisRunBody,
  mapStartScanResultToHttpBody,
} from "../map-start-scan-result";

describe("mapStartScanResultToHttpBody", () => {
  it("maps scheduled outcome", () => {
    const mapped = mapStartScanResultToHttpBody({
      outcome: "scheduled",
      scanId: "run-1",
      scanJobId: "job-1",
      branch: "main",
      commitSha: "abc",
      scan: { id: "run-1", status: "queued" },
      correlationId: "corr-1",
      duplicate: false,
    });
    expect(mapped.status).toBe(202);
    expect(mapped.body.scanId).toBe("run-1");
  });

  it("maps in-progress conflict", () => {
    const mapped = mapStartScanResultToHttpBody({
      outcome: "in_progress",
      scan: { id: "run-active" },
    });
    expect(mapped.status).toBe(409);
    expect(mapped.body.code).toBe("SCAN_IN_PROGRESS");
  });
});

describe("mapStartScanResultToAnalysisRunBody", () => {
  it("adds run-scoped navigation hrefs", () => {
    const mapped = mapStartScanResultToAnalysisRunBody("proj-1", {
      outcome: "scheduled",
      scanId: "run-1",
      scanJobId: "job-1",
      branch: "main",
      commitSha: "abc",
      scan: { id: "run-1" },
      correlationId: "corr-1",
      duplicate: false,
    });
    expect(mapped.body.runId).toBe("run-1");
    expect(mapped.body.missionControlHref).toBe("/projects/proj-1/mission-control?run=run-1");
    expect(mapped.body.attackCenterHref).toBe("/projects/proj-1/attack-center?run=run-1");
  });
});
