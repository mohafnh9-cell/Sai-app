import { describe, expect, it } from "vitest";
import { createBusinessLogicCapabilityRegistry } from "../register-business-logic-capabilities";

describe("RT9 consumes RT-Core capabilities", () => {
  it("registers and resolves business logic pipeline dependencies", () => {
    const registry = createBusinessLogicCapabilityRegistry();
    const validation = registry.validateConsumer({
      required: ["rt9.business_logic.pipeline"],
    });
    expect(validation.valid).toBe(true);
    const resolution = registry.resolveDependencies(["rt9.business_logic.pipeline"]);
    expect(resolution.missing).toEqual([]);
    expect(resolution.orderedCapabilityIds).toContain("core.findings.engine");
  });
});
