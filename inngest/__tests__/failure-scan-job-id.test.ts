import { describe, expect, it } from "vitest";
import { scanJobIdFromInngestFailure } from "../failure-scan-job-id";

describe("scanJobIdFromInngestFailure", () => {
  it("reads scanJobId from nested trigger event", () => {
    const id = scanJobIdFromInngestFailure({
      name: "inngest/function.failed",
      data: {
        function_id: "github-webhook-process",
        run_id: "run-1",
        error: { name: "Error", message: "boom", stack: "" },
        event: {
          name: "github/webhook.process",
          data: { scanJobId: "job-abc" },
        },
      },
    } as Parameters<typeof scanJobIdFromInngestFailure>[0]);
    expect(id).toBe("job-abc");
  });

  it("returns undefined when trigger payload has no scanJobId", () => {
    expect(
      scanJobIdFromInngestFailure({
        name: "inngest/function.failed",
        data: {
          function_id: "x",
          run_id: "r",
          error: { name: "Error", message: "x", stack: "" },
          event: { name: "cp/daily.project", data: { projectId: "p", organizationId: "o" } },
        },
      } as Parameters<typeof scanJobIdFromInngestFailure>[0])
    ).toBeUndefined();
  });
});
