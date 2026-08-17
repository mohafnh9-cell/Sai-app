import type { FindingVerificationStatus } from "@/server/full-product-audit/types";
import type { AgentAction, ExternalConfidence } from "./schema";
import type { ExternalSecuritySourceTool } from "./constants";

const HEURISTIC_SOURCE_TOOLS = new Set<ExternalSecuritySourceTool>([
  "scan_agent_prompt",
  "scan_skill",
  "scan_agent_action",
]);

const STATIC_SOURCE_TOOLS = new Set<ExternalSecuritySourceTool>([
  "scan_security",
  "scan_project",
  "scan_mcp_server",
  "scan_diff",
]);

/**
 * Initial verification status for external scanner findings.
 * SequrAI never treats raw scanner output as CONFIRMED without repository verification.
 */
export function deriveInitialVerificationStatus(input: {
  sourceTool: ExternalSecuritySourceTool;
  confidence: ExternalConfidence;
  action: AgentAction | null;
}): FindingVerificationStatus {
  if (HEURISTIC_SOURCE_TOOLS.has(input.sourceTool)) {
    if (input.action === "BLOCK" && input.confidence === "HIGH") {
      return "LIKELY";
    }
    return "UNVERIFIED";
  }

  if (input.sourceTool === "osv") {
    return input.confidence === "HIGH" ? "LIKELY" : "POTENTIAL";
  }

  if (input.sourceTool === "scan_packages") {
    if (input.confidence === "HIGH" && input.action === "BLOCK") {
      return "LIKELY";
    }
    return input.confidence === "HIGH" ? "POTENTIAL" : "UNVERIFIED";
  }

  if (STATIC_SOURCE_TOOLS.has(input.sourceTool)) {
    if (input.confidence === "HIGH") {
      return "POTENTIAL";
    }
    return "UNVERIFIED";
  }

  return "UNVERIFIED";
}
