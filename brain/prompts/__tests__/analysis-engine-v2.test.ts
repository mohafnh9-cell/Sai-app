import { describe, expect, it } from "vitest";
import {
  ANALYSIS_ENGINE_V2_VERSION,
  NOT_ENOUGH_EVIDENCE,
  getAnalysisEngineV2NarrativeSupplement,
  getAnalysisEngineV2Prompt,
  notEnoughEvidenceReason,
} from "@/brain/prompts/analysis-engine-v2";

describe("Analysis Engine V2 prompt", () => {
  it("exposes version and NOT ENOUGH EVIDENCE constant", () => {
    expect(ANALYSIS_ENGINE_V2_VERSION).toBe("2.0.0");
    expect(NOT_ENOUGH_EVIDENCE).toBe("NOT ENOUGH EVIDENCE");
  });

  it("loads the canonical markdown prompt", () => {
    const prompt = getAnalysisEngineV2Prompt();
    expect(prompt).toContain("SequrAI Analysis Engine V2");
    expect(prompt).toContain("Zero false positive policy");
    expect(prompt).toContain("Phase 8 — Production Verdict");
  });

  it("builds narrative supplement for post-scan enrichment", () => {
    expect(getAnalysisEngineV2NarrativeSupplement("en")).toContain(NOT_ENOUGH_EVIDENCE);
    expect(getAnalysisEngineV2NarrativeSupplement("es")).toContain("Spanish");
  });

  it("prefixes gate discard reasons", () => {
    expect(notEnoughEvidenceReason("File, line, and proof are required.")).toBe(
      "NOT ENOUGH EVIDENCE: File, line, and proof are required."
    );
  });
});
