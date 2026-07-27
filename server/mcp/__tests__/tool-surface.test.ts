import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MCP_TOOL_DEFINITIONS } from "../tool-definitions";
import { COPILOT_BRAIN_TOOLS } from "@/brain/copilot-contract";

/**
 * ADR-001 / MCP V1 + RT2: six public tools including discover_application.
 */
describe("MCP public tool surface", () => {
  it("registers exactly six public tools", () => {
    expect(MCP_TOOL_DEFINITIONS).toHaveLength(6);
  });

  it("registers the canonical MCP tools", () => {
    const registeredNames = MCP_TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(registeredNames).toEqual([
      "review_now",
      "can_i_deploy",
      "safe_fix",
      "what_changed",
      "production_history",
      "discover_application",
    ]);
  });

  it("has no duplicate tool names", () => {
    const names = MCP_TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps brain/copilot-contract.ts in sync with the MCP registration", () => {
    const registeredNames = new Set(MCP_TOOL_DEFINITIONS.map((tool) => tool.name));
    const contractNames = new Set(COPILOT_BRAIN_TOOLS);
    expect(contractNames).toEqual(registeredNames);
  });

  it("does not expose legacy V0 tool names removed during the ADR-001 cleanup, nor deployment_confidence (retired in favor of review_now)", () => {
    const removedLegacyNames = [
      "get_today_priorities",
      "get_coach_tip",
      "get_timeline",
      "run_production_check",
      "explain_issue",
      "generate_blocker_fix",
      "review_before_commit",
      "deployment_confidence",
    ];
    const registeredNames = MCP_TOOL_DEFINITIONS.map((tool) => tool.name);
    for (const legacyName of removedLegacyNames) {
      expect(registeredNames).not.toContain(legacyName);
    }
  });

  it("does not dispatch any case in executeMcpTool beyond the registered tool set", () => {
    const registeredNames = new Set(MCP_TOOL_DEFINITIONS.map((tool) => tool.name));
    const executeToolSource = fs.readFileSync(
      path.resolve(__dirname, "../execute-tool.ts"),
      "utf8"
    );
    const caseNames = Array.from(
      executeToolSource.matchAll(/case\s+"([a-z_]+)"\s*:/g)
    ).map((match) => match[1]);

    expect(caseNames.length).toBeGreaterThan(0);
    for (const caseName of caseNames) {
      expect(registeredNames.has(caseName)).toBe(true);
    }
  });
});
