import { describe, expect, it } from "vitest";
import { runScanRedTeamPipeline } from "../run-scan-red-team";

describe("runScanRedTeamPipeline certification hooks", () => {
  it("records failed status when fault injection is enabled", async () => {
    process.env.ALLOW_PLATFORM_CONVERGENCE_FAULT_INJECTION = "1";
    process.env.PLATFORM_CONVERGENCE_CERT_INJECT_FAULT = "logic.business";
    const result = await runScanRedTeamPipeline({
      scanId: "00000000-0000-4000-8000-000000000010",
      scanJobId: "00000000-0000-4000-8000-000000000011",
      organizationId: "00000000-0000-4000-8000-000000000012",
      projectId: "00000000-0000-4000-8000-000000000013",
      commitSha: "abc123",
      files: [{ path: "app/route.ts", content: "export {}" }],
    });
    delete process.env.ALLOW_PLATFORM_CONVERGENCE_FAULT_INJECTION;
    delete process.env.PLATFORM_CONVERGENCE_CERT_INJECT_FAULT;
    expect(result.status).toBe("failed");
    expect(result.securityDecision).toBeNull();
    expect(result.ids.correlationId).toBe(result.ids.scanId);
    expect(result.ids.executionId).toBe(result.ids.scanJobId);
  });
});
