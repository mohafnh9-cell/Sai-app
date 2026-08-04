import { describe, expect, it } from "vitest";
import { analysisRunKeys } from "../query-keys";

describe("analysisRunKeys", () => {
  it("builds hierarchical keys per project and run", () => {
    expect(analysisRunKeys.project("proj-1")).toEqual(["analysis-run", "proj-1"]);
    expect(analysisRunKeys.run("proj-1", "run-1")).toEqual([
      "analysis-run",
      "proj-1",
      "run-1",
    ]);
  });

  it("scopes mission control and attack center to run when provided", () => {
    expect(analysisRunKeys.missionControl("proj-1", "run-1")).toEqual([
      "analysis-run",
      "proj-1",
      "run-1",
      "mission-control",
    ]);
    expect(analysisRunKeys.attackCenter("proj-1", "run-1")).toEqual([
      "analysis-run",
      "proj-1",
      "run-1",
      "attack-center",
    ]);
  });

  it("falls back to project scope without run id", () => {
    expect(analysisRunKeys.missionControl("proj-1")).toEqual([
      "analysis-run",
      "proj-1",
      "mission-control",
    ]);
  });

  it("builds list and security-tests keys", () => {
    expect(analysisRunKeys.list("proj-1")).toEqual(["analysis-run", "proj-1", "list"]);
    expect(analysisRunKeys.securityTests("proj-1", "run-1")).toEqual([
      "analysis-run",
      "proj-1",
      "run-1",
      "security-tests",
    ]);
  });
});
