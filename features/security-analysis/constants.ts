/** External scanner package we integrate — not a SequrAI product identity. */
export const AGENT_SECURITY_SCANNER_ID = "agent-security-scanner-mcp" as const;
export const AGENT_SECURITY_SCANNER_VERSION = "4.5.8" as const;

/** Source tools inside agent-security-scanner-mcp (maps to normalizeFinding sourceTool). */
export const EXTERNAL_SECURITY_SOURCE_TOOLS = [
  "scan_security",
  "scan_agent_prompt",
  "scan_project",
  "scan_skill",
  "scan_mcp_server",
  "scan_agent_action",
  "scan_packages",
  "scan_diff",
  "osv",
  "sbom",
] as const;

export type ExternalSecuritySourceTool = (typeof EXTERNAL_SECURITY_SOURCE_TOOLS)[number];
