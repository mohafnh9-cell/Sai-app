import { describe, expect, it } from "vitest";
import { analysisRunKeys } from "../../lib/query-keys";

describe("analysisRunKeys (Sprint 7)", () => {
  it("builds list and security-tests keys", () => {
    expect(analysisRunKeys.list("proj-1")).toEqual(["analysis-run", "proj-1", "list"]);
    expect(analysisRunKeys.securityTests("proj-1", "run-1")).toEqual([
      "analysis-run",
      "proj-1",
      "run-1",
      "security-tests",
    ]);
    expect(analysisRunKeys.securityTests("proj-1")).toEqual([
      "analysis-run",
      "proj-1",
      "security-tests",
    ]);
  });
});
