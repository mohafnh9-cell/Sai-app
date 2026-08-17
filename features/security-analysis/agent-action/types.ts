export type AgentActionType =
  | "bash"
  | "file_write"
  | "file_read"
  | "http_request"
  | "file_delete"
  | "cron"
  | "process_spawn"
  | "git"
  | "docker";

export type AgentActionSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type AgentActionDecision = "BLOCK" | "WARN" | "ALLOW";

export type AgentActionTier =
  | "capability-detected"
  | "potentially-dangerous"
  | "insufficient-restrictions"
  | "likely-exploitable";

export type AgentActionCheckFinding = {
  rule: string;
  severity: AgentActionSeverity;
  action: AgentActionDecision;
  message: string;
};

export type AgentActionRawFinding = {
  rule: string;
  severity: AgentActionSeverity;
  action: AgentActionDecision;
  message: string;
  category: string;
  file: string;
  line: number;
  match?: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  tier: AgentActionTier;
  actionType: AgentActionType;
  toolName?: string;
};

export type AgentScanResult = {
  findings: AgentActionRawFinding[];
  filesScanned: number;
  filesConsidered: number;
};

export type DiscoveredAgentTool = {
  name: string;
  line: number;
  block: string;
  framework: "mcp" | "ai-sdk" | "openai" | "langchain" | "generic";
};
