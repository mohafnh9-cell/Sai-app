import { describe, expect, it } from "vitest";
import { coerceVerdictForUi } from "@/brain/production-verdict/coerce-verdict-for-ui";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

describe("coerceVerdictForUi", () => {
  it("returns null for null input", () => {
    expect(coerceVerdictForUi(null)).toBeNull();
  });

  it("fills missing array fields with empty arrays", () => {
    const partial = {
      status: "not_ready",
    } as ProductionVerdictV1;

    const coerced = coerceVerdictForUi(partial);
    expect(coerced?.topPriorities).toEqual([]);
    expect(coerced?.evaluatedAreas).toEqual([]);
    expect(coerced?.partiallyEvaluatedAreas).toEqual([]);
    expect(coerced?.unevaluatedAreas).toEqual([]);
  });
});
