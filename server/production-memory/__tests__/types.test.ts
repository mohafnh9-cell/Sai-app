import { describe, expect, it } from "vitest";
import {
  compositeHealthScore,
  deployAnswerFromVerdictStatus,
  healthLabelFromScore,
  protectionStatusFromVerdict,
} from "@/server/production-memory/types";

describe("production memory types", () => {
  it("maps verdict status to deploy answers", () => {
    expect(deployAnswerFromVerdictStatus("ready_to_ship")).toBe("go");
    expect(deployAnswerFromVerdictStatus("not_ready")).toBe("no_go");
    expect(deployAnswerFromVerdictStatus("almost_ready")).toBe("not_yet");
    expect(deployAnswerFromVerdictStatus("insufficient_data")).toBe("not_yet");
  });

  it("maps verdict status to protection status", () => {
    expect(protectionStatusFromVerdict("ready_to_ship")).toBe("protected");
    expect(protectionStatusFromVerdict("not_ready")).toBe("requires_attention");
  });

  it("caps health label when protection requires attention", () => {
    expect(healthLabelFromScore(90, "requires_attention")).toBe("needs_attention");
  });

  it("computes composite health from production and security confidence", () => {
    expect(compositeHealthScore(80, 60)).toBe(70);
    expect(compositeHealthScore(null, 40)).toBe(40);
  });
});
