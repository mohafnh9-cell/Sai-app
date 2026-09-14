import { afterEach, describe, expect, it, vi } from "vitest";
import { generateStructuredSecurityReasoning } from "../gateway";
import { createTestDoubleProvider } from "../providers/test-double";
import type { AiProviderClient } from "../types";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Phase 37 -- AI Gateway (workstream D)", () => {
  it("returns DISABLED without calling any provider when AI_REASONING_ENABLED is not true", async () => {
    vi.stubEnv("AI_REASONING_ENABLED", "");
    const provider: AiProviderClient = {
      id: "spy",
      generateStructured: vi.fn(async () => ({ rawText: "{}" })),
    };
    const outcome = await generateStructuredSecurityReasoning({
      systemPrompt: "s",
      userPrompt: "u",
      knownIds: new Set(),
      providerOverride: provider,
    });
    expect(outcome.status).toBe("DISABLED");
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it("returns COMPLETED with a validated result for well-formed, evidence-honest provider output (test-double provider)", async () => {
    vi.stubEnv("AI_REASONING_ENABLED", "true");
    const provider = createTestDoubleProvider(
      JSON.stringify({
        summary: "One SQL injection finding.",
        prioritizedFindings: [{ findingId: "f1", evidenceIds: [], reason: "highest severity", confidence: "SUPPORTED" }],
        attackChainAssessments: [],
        architectureObservations: [],
        investigationRecommendations: [],
        remediationRecommendations: ["Use parameterized queries."],
        confidence: "SUPPORTED",
        evidenceReferences: ["f1"],
      })
    );
    const outcome = await generateStructuredSecurityReasoning({
      systemPrompt: "s",
      userPrompt: "u",
      knownIds: new Set(["f1"]),
      providerOverride: provider,
    });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status === "COMPLETED") {
      expect(outcome.result.prioritizedFindings[0]?.findingId).toBe("f1");
      expect(outcome.provider).toBe("test-double");
    }
  });

  it("rejects output that references a finding id the caller never supplied -- a hallucinated id (section 12/29)", async () => {
    vi.stubEnv("AI_REASONING_ENABLED", "true");
    const provider = createTestDoubleProvider(
      JSON.stringify({
        summary: "s",
        prioritizedFindings: [{ findingId: "f1-DOES-NOT-EXIST", evidenceIds: [], reason: "r", confidence: "SUPPORTED" }],
        attackChainAssessments: [],
        architectureObservations: [],
        investigationRecommendations: [],
        remediationRecommendations: [],
        confidence: "SUPPORTED",
        evidenceReferences: [],
      })
    );
    const outcome = await generateStructuredSecurityReasoning({
      systemPrompt: "s",
      userPrompt: "u",
      knownIds: new Set(["f1"]), // f1-DOES-NOT-EXIST is not in the known set
      providerOverride: provider,
    });
    expect(outcome.status).toBe("FAILED");
    if (outcome.status === "FAILED") expect(outcome.reason).toMatch(/unverifiable ids/);
  });

  it("rejects malformed (non-JSON) provider output as FAILED, never as a security decision", async () => {
    vi.stubEnv("AI_REASONING_ENABLED", "true");
    const provider = createTestDoubleProvider("I think everything looks fine, no need for JSON here.");
    const outcome = await generateStructuredSecurityReasoning({
      systemPrompt: "s",
      userPrompt: "u",
      knownIds: new Set(),
      providerOverride: provider,
    });
    expect(outcome.status).toBe("FAILED");
  });

  it("rejects output that fails schema validation (missing required fields)", async () => {
    vi.stubEnv("AI_REASONING_ENABLED", "true");
    const provider = createTestDoubleProvider(JSON.stringify({ summary: "s" })); // missing everything else
    const outcome = await generateStructuredSecurityReasoning({
      systemPrompt: "s",
      userPrompt: "u",
      knownIds: new Set(),
      providerOverride: provider,
    });
    expect(outcome.status).toBe("FAILED");
  });

  it("returns TIMED_OUT (never blocks indefinitely) when the provider never resolves within the configured budget", async () => {
    vi.stubEnv("AI_REASONING_ENABLED", "true");
    vi.stubEnv("AI_REASONING_TIMEOUT_MS", "50");
    const provider: AiProviderClient = {
      id: "slow",
      generateStructured: () => new Promise(() => {}), // never resolves
    };
    const outcome = await generateStructuredSecurityReasoning({
      systemPrompt: "s",
      userPrompt: "u",
      knownIds: new Set(),
      providerOverride: provider,
    });
    expect(outcome.status).toBe("TIMED_OUT");
  });

  it("returns FAILED (never throws) when the provider itself errors, e.g. rate limit / unavailable", async () => {
    vi.stubEnv("AI_REASONING_ENABLED", "true");
    const provider: AiProviderClient = {
      id: "broken",
      generateStructured: async () => {
        throw new Error("rate limited");
      },
    };
    const outcome = await generateStructuredSecurityReasoning({
      systemPrompt: "s",
      userPrompt: "u",
      knownIds: new Set(),
      providerOverride: provider,
    });
    expect(outcome.status).toBe("FAILED");
  });

  it("extracts a JSON object even when the provider wraps it in prose/code fences", async () => {
    vi.stubEnv("AI_REASONING_ENABLED", "true");
    const validPayload = {
      summary: "s",
      prioritizedFindings: [],
      attackChainAssessments: [],
      architectureObservations: [],
      investigationRecommendations: [],
      remediationRecommendations: [],
      confidence: "SUPPORTED",
      evidenceReferences: [],
    };
    const provider = createTestDoubleProvider("Here is my analysis:\n```json\n" + JSON.stringify(validPayload) + "\n```\nLet me know if you need more.");
    const outcome = await generateStructuredSecurityReasoning({
      systemPrompt: "s",
      userPrompt: "u",
      knownIds: new Set(),
      providerOverride: provider,
    });
    expect(outcome.status).toBe("COMPLETED");
  });
});
