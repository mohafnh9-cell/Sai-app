import { describe, expect, it } from "vitest";
import { RT9_BUSINESS_LOGIC_MANIFEST } from "../manifest";
import { RT10_LLM_MANIFEST } from "../../../llm-team/declarative/manifest";
import { globalPluginRegistry } from "../../../core/declarative/plugin/plugin-registry";
import "../../../llm-team/declarative/register";

describe("Declarative manifests", () => {
  it("RT9 manifest declares canonical pipeline modules", () => {
    expect(RT9_BUSINESS_LOGIC_MANIFEST.id).toBe("rt9.business_logic");
    expect(RT9_BUSINESS_LOGIC_MANIFEST.discoveryModules.length).toBeGreaterThan(0);
    expect(RT9_BUSINESS_LOGIC_MANIFEST.findingBuilders.length).toBeGreaterThan(0);
  });

  it("RT10 manifest declares canonical pipeline modules", () => {
    expect(RT10_LLM_MANIFEST.id).toBe("rt10.llm");
    expect(RT10_LLM_MANIFEST.runtimeProfiles.length).toBeGreaterThan(0);
  });

  it("RT10 plugin auto-registers", () => {
    expect(globalPluginRegistry.get("rt10.llm.plugin")).toBeTruthy();
  });
});
