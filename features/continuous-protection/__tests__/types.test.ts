import { describe, expect, it } from "vitest";
import {
  protectionStatusAccent,
  protectionStatusTone,
} from "@/features/continuous-protection/types";

describe("protection status presentation", () => {
  it("maps each status to distinct tone classes", () => {
    expect(protectionStatusTone("PROTECTED")).toContain("emerald");
    expect(protectionStatusTone("SAFE_WITH_CAUTION")).toContain("amber");
    expect(protectionStatusTone("REQUIRES_ATTENTION")).toContain("orange");
    expect(protectionStatusTone("NOT_PROTECTED")).toContain("border");
  });

  it("maps each status to accent colors", () => {
    expect(protectionStatusAccent("PROTECTED")).toContain("success");
    expect(protectionStatusAccent("NOT_PROTECTED")).toContain("muted");
  });
});
