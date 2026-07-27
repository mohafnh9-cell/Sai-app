import { describe, expect, it } from "vitest";
import { createLlmTeamCapabilityRegistry } from "../register-llm-capabilities";

describe("RT10 consumes RT-Core capabilities", () => {
  it("registers and resolves LLM pipeline dependencies", () => {
    const registry = createLlmTeamCapabilityRegistry();
    const validation = registry.validateConsumer({
      required: ["rt10.llm.pipeline"],
    });
    expect(validation.valid).toBe(true);
    const resolution = registry.resolveDependencies(["rt10.llm.pipeline"]);
    expect(resolution.missing).toEqual([]);
    expect(resolution.orderedCapabilityIds).toContain("core.preconditions.model");
  });
});
