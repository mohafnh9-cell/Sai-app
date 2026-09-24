import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { describe, expect, it } from "vitest";
import {
  compositeHealthScore,
  deployAnswerFromVerdictEvidence,
  healthLabelFromScore,
  protectionStatusFromVerdict,
} from "@/server/production-memory/types";

describe("production memory types", () => {
  const ev = (status: VerdictStatus, confidence: "high" | "medium" | "low" = "high", unevaluated = 0) => ({
    status,
    confidence,
    unevaluatedAreas: Array.from({ length: unevaluated }, () => ({}) as never),
    partiallyEvaluatedAreas: [],
  });

  it("derives deploy answers from evidence, not status alone", () => {
    expect(deployAnswerFromVerdictEvidence(ev("ready_to_ship"))).toBe("go");
    expect(deployAnswerFromVerdictEvidence(ev("ready_to_ship", "medium", 2))).toBe("go");
    // NEW-2: ready_to_ship + low confidence must never be recorded as "go".
    expect(deployAnswerFromVerdictEvidence(ev("ready_to_ship", "low"))).toBe("not_yet");
    expect(deployAnswerFromVerdictEvidence(ev("not_ready"))).toBe("no_go");
    expect(deployAnswerFromVerdictEvidence(ev("almost_ready"))).toBe("not_yet");
    expect(deployAnswerFromVerdictEvidence(ev("insufficient_data"))).toBe("not_yet");
  });

  it("only reports 'protected' when first-person approval is allowed", () => {
    expect(protectionStatusFromVerdict(ev("ready_to_ship"))).toBe("protected");
    expect(protectionStatusFromVerdict(ev("ready_to_ship", "low"))).toBe("safe_with_caution");
    expect(protectionStatusFromVerdict(ev("ready_to_ship", "high", 4))).toBe("safe_with_caution");
    expect(protectionStatusFromVerdict(ev("not_ready"))).toBe("requires_attention");
  });

  it("caps health label when protection requires attention", () => {
    expect(healthLabelFromScore(90, "requires_attention")).toBe("needs_attention");
  });

  it("computes composite health from production and security confidence", () => {
    expect(compositeHealthScore(80, 60)).toBe(70);
    expect(compositeHealthScore(null, 40)).toBe(40);
  });
});
