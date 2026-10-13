import { describe, expect, it } from "vitest";
import { assessEvidenceReadiness } from "../evidence-readiness";

const NOW = Date.parse("2026-10-10T07:13:00.000Z");
const alive = { status: "running", heartbeat_at: new Date(NOW - 5_000).toISOString() };
const dead = { status: "running", heartbeat_at: new Date(NOW - 60 * 60_000).toISOString() };
const jobs = (...pairs: Array<[string, string]>) => pairs.map(([engine, status]) => ({ engine, status }));

describe("the signal that the evidence for a verdict is ready", () => {
  it("pipeline: marker + every engine terminal (COMPLETED, FAILED, TIMED_OUT, CANCELLED, REJECTED all count as terminal)", () => {
    for (const status of ["COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED", "REJECTED"]) {
      expect(assessEvidenceReadiness({ mode: "pipeline", jobs: jobs(["trivy", status]), evidenceMarkerPresent: true, liveScanJobs: [alive], nowMs: NOW })).toEqual({ ready: true });
    }
  });

  it("pipeline: engines exist but the runner has not marked its own stages finished -> not ready", () => {
    expect(assessEvidenceReadiness({ mode: "pipeline", jobs: jobs(["trivy", "COMPLETED"]), evidenceMarkerPresent: false, liveScanJobs: [], nowMs: NOW }))
      .toEqual({ ready: false, reason: "evidence_not_ready", pendingEngines: [] });
  });

  it("pipeline: any engine QUEUED or RUNNING -> not ready, naming them", () => {
    expect(assessEvidenceReadiness({ mode: "pipeline", jobs: jobs(["opengrep", "COMPLETED"], ["trivy", "RUNNING"], ["crypto", "QUEUED"]), evidenceMarkerPresent: true, liveScanJobs: [], nowMs: NOW }))
      .toEqual({ ready: false, reason: "engines_pending", pendingEngines: ["trivy", "crypto"] });
  });

  it("pipeline: no engine jobs YET and a live scan job (it may be about to create them) -> not ready", () => {
    expect(assessEvidenceReadiness({ mode: "pipeline", jobs: [], evidenceMarkerPresent: false, liveScanJobs: [alive], nowMs: NOW }))
      .toEqual({ ready: false, reason: "evidence_not_ready", pendingEngines: [] });
  });

  it("pipeline: no engine jobs and no live scan job (an upload, or an abandoned runner) -> ready", () => {
    expect(assessEvidenceReadiness({ mode: "pipeline", jobs: [], evidenceMarkerPresent: false, liveScanJobs: [], nowMs: NOW })).toEqual({ ready: true });
    expect(assessEvidenceReadiness({ mode: "pipeline", jobs: [], evidenceMarkerPresent: false, liveScanJobs: [dead], nowMs: NOW })).toEqual({ ready: true });
  });

  it("recovery: no marker is needed, but a pending engine still blocks", () => {
    expect(assessEvidenceReadiness({ mode: "recovery", jobs: jobs(["trivy", "COMPLETED"]), evidenceMarkerPresent: false, liveScanJobs: [], nowMs: NOW })).toEqual({ ready: true });
    expect(assessEvidenceReadiness({ mode: "recovery", jobs: jobs(["trivy", "RUNNING"]), evidenceMarkerPresent: false, liveScanJobs: [], nowMs: NOW }))
      .toEqual({ ready: false, reason: "engines_pending", pendingEngines: ["trivy"] });
  });
});
