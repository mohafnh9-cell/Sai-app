import { describe, expect, it } from "vitest";
import { generateProductionVerdict } from "@/brain/production-verdict/engine";
import { LOCAL_PROJECT_ID, LOCAL_REPOSITORY_ID } from "@/lib/local-analysis/constants";

describe("Production Verdict V1 isolation", () => {
  it("uses brain/production-verdict/engine as the canonical scorer", () => {
    const { verdict } = generateProductionVerdict({
      projectId: LOCAL_PROJECT_ID,
      repositoryId: LOCAL_REPOSITORY_ID,
      scanId: "22222222-2222-4222-8222-222222222222",
      commitSha: "abc",
      branch: "main",
      scanStatus: "completed",
      securityScore: 95,
      filesAnalyzed: 5,
      filesDiscovered: 5,
      findings: [],
    });

    expect(verdict.version).toBe("1.0.0");
    expect(verdict.status).toBe("ready_to_ship");
  });

  it("does not import AI Red Team alternate verdict modules in the canonical engine path", async () => {
    const engineModule = await import("@/brain/production-verdict/engine");
    expect(typeof engineModule.generateProductionVerdict).toBe("function");
    expect(Object.keys(engineModule)).not.toContain("generateRedTeamProductionVerdict");
  });
});
