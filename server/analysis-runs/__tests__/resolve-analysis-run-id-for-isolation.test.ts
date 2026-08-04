import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  requestedAnalysisRunIdFromRequest,
  resolveAnalysisRunIdForIsolation,
} from "../resolve-analysis-run-id-for-isolation";

vi.mock("../get-analysis-run-snapshot", () => ({
  isAnalysisRunOwnedByProject: vi.fn(),
}));

vi.mock("../resolve-analysis-run", () => ({
  resolveAnalysisRunForMissionControl: vi.fn(),
}));

import { isAnalysisRunOwnedByProject } from "../get-analysis-run-snapshot";
import { resolveAnalysisRunForMissionControl } from "../resolve-analysis-run";

describe("requestedAnalysisRunIdFromRequest", () => {
  it("prefers body run id over query", () => {
    const request = new Request("https://app.test/api/projects/p/security-tests?run=query-run");
    expect(requestedAnalysisRunIdFromRequest(request, "body-run")).toBe("body-run");
  });

  it("reads run from query when body omitted", () => {
    const request = new Request("https://app.test/api/projects/p/security-tests?run=query-run");
    expect(requestedAnalysisRunIdFromRequest(request)).toBe("query-run");
  });
});

describe("resolveAnalysisRunIdForIsolation", () => {
  beforeEach(() => {
    vi.mocked(isAnalysisRunOwnedByProject).mockReset();
    vi.mocked(resolveAnalysisRunForMissionControl).mockReset();
  });

  it("returns explicit run when isolation is off", async () => {
    const result = await resolveAnalysisRunIdForIsolation({} as never, {
      projectId: "proj-1",
      organizationId: "org-1",
      requestedRunId: "run-1",
      isolationEnabled: false,
    });
    expect(result).toEqual({ runId: "run-1", invalidRequest: false });
  });

  it("validates ownership when isolation is on", async () => {
    vi.mocked(isAnalysisRunOwnedByProject).mockResolvedValue(true);
    const result = await resolveAnalysisRunIdForIsolation({} as never, {
      projectId: "proj-1",
      organizationId: "org-1",
      requestedRunId: "run-1",
      isolationEnabled: true,
    });
    expect(result).toEqual({ runId: "run-1", invalidRequest: false });
  });

  it("marks invalid when requested run is not owned", async () => {
    vi.mocked(isAnalysisRunOwnedByProject).mockResolvedValue(false);
    const result = await resolveAnalysisRunIdForIsolation({} as never, {
      projectId: "proj-1",
      organizationId: "org-1",
      requestedRunId: "run-bad",
      isolationEnabled: true,
    });
    expect(result).toEqual({ runId: null, invalidRequest: true });
  });

  it("auto-resolves when isolation is on and run omitted", async () => {
    vi.mocked(resolveAnalysisRunForMissionControl).mockResolvedValue({
      runId: "run-resolved",
      source: "latest_completed",
      valid: true,
    });
    const result = await resolveAnalysisRunIdForIsolation({} as never, {
      projectId: "proj-1",
      organizationId: "org-1",
      isolationEnabled: true,
    });
    expect(result).toEqual({ runId: "run-resolved", invalidRequest: false });
  });
});
