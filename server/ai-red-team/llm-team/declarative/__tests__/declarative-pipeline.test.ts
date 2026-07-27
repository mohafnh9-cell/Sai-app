import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import { runLlmDeclarativePipeline } from "../run-declarative-pipeline";

function aiDiscovery(): DiscoveryReport {
  return {
    reportId: "d-rt10",
    projectId: "p1",
    organizationId: "o1",
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "AI SaaS",
    detectedTechnologies: [
      { id: "lc", name: "LangChain", category: "ai", confidence: 0.9, evidence: ["package.json"] },
    ],
    authenticationProviders: [],
    database: [],
    payments: [],
    aiProviders: [{ id: "openai", name: "OpenAI", category: "ai", confidence: 0.95, evidence: ["sdk"] }],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: ["npm"],
    potentialAttackSurface: [{ area: "llm", label: "Chat", rationale: "x", confidence: 0.9 }],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.9,
    cached: false,
  };
}

describe("RT10 declarative pipeline", () => {
  it("produces findings like the legacy pipeline", async () => {
    const { result, pipeline } = await runLlmDeclarativePipeline({
      organizationId: "o1",
      projectId: "p1",
      runId: "run",
      requestId: "req",
      discoveryReport: aiDiscovery(),
      plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
      llmTeamRunId: "run-1",
    });
    expect(pipeline.status).not.toBe("failed");
    const findingsStage = pipeline.stageResults.find((s) => s.stageId === "findings");
    expect(findingsStage?.status).toBe("completed");
    expect(result.findingsCount).toBeGreaterThan(0);
  });
});
