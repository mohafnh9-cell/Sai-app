import { describe, expect, it } from "vitest";
import { verdictStatusToCheckConclusion } from "@/server/github-automation/github-check-run";

describe("verdictStatusToCheckConclusion", () => {
  it("maps GO to success", () => {
    expect(verdictStatusToCheckConclusion("ready_to_ship")).toBe("success");
  });

  it("maps NO-GO statuses to failure", () => {
    expect(verdictStatusToCheckConclusion("not_ready")).toBe("failure");
    expect(verdictStatusToCheckConclusion("almost_ready")).toBe("failure");
  });

  it("maps insufficient_data to action_required", () => {
    expect(verdictStatusToCheckConclusion("insufficient_data")).toBe("action_required");
  });

  it("maps analysis_failed and missing scan to failure/neutral", () => {
    expect(verdictStatusToCheckConclusion("analysis_failed")).toBe("failure");
    expect(
      verdictStatusToCheckConclusion(null, { scanMissing: true })
    ).toBe("neutral");
    expect(
      verdictStatusToCheckConclusion("ready_to_ship", { checkStatus: "pending" })
    ).toBe("neutral");
  });
});
