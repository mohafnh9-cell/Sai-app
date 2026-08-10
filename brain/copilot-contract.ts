import type { ProjectBrainSnapshot } from "./types";

/** Contract for Block 7 Security Copilot — read-only subset of Brain */
export type CopilotReadableContext = Pick<
  ProjectBrainSnapshot,
  | "projectId"
  | "projectName"
  | "productionReady"
  | "todayPriorities"
  | "coachTip"
  | "executiveSummary"
  | "recentActivity"
>;

// ADR-001 / MCP V1 + RT2: mirrors server/mcp/tool-definitions.ts (8 public tools).
export const COPILOT_BRAIN_TOOLS = [
  "full_product_audit",
  "review_now",
  "cancel_review",
  "can_i_deploy",
  "safe_fix",
  "what_changed",
  "production_history",
  "discover_application",
] as const;

export type CopilotBrainTool = (typeof COPILOT_BRAIN_TOOLS)[number];
