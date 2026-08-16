import "server-only";

export type McpCallLog = {
  tool: string;
  organizationId: string;
  projectId?: string | null;
  durationMs: number;
  result: "success" | "error";
  errorCode?: string;
  clientName?: string | null;
  authType?: "api_key" | "oauth" | null;
  clientId?: string | null;
  source?: "legacy_api_key" | "oauth_token" | null;
};

/**
 * Safe, structured logging for MCP tool calls.
 *
 * Never log: API keys, Authorization headers, GitHub tokens, secrets,
 * private source file contents, or Safe Fix Prompt bodies.
 */
export function logMcpCall(entry: McpCallLog): void {
  console.info({
    component: "mcp-tool-call",
    tool: entry.tool,
    organizationId: entry.organizationId,
    projectId: entry.projectId ?? null,
    durationMs: entry.durationMs,
    result: entry.result,
    errorCode: entry.errorCode ?? null,
    clientName: entry.clientName ?? null,
    authType: entry.authType ?? null,
    clientId: entry.clientId ?? null,
    source: entry.source ?? null,
  });
}
