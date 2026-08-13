export type McpClient = "cursor" | "claude" | "vscode";

function mcpEndpoint(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, "")}/api/mcp`;
}

function authHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` };
}

/** HTTP transport — works from any project; no local bridge script required. */
function httpServer(apiKey: string, apiUrl: string) {
  return {
    url: mcpEndpoint(apiUrl),
    headers: authHeaders(apiKey),
  };
}

function claudeHttpServer(apiKey: string, apiUrl: string) {
  return {
    type: "http" as const,
    url: mcpEndpoint(apiUrl),
    headers: authHeaders(apiKey),
  };
}

export function buildMcpClientConfig(
  client: McpClient,
  apiKey: string,
  apiUrl: string
): string {
  const config =
    client === "vscode"
      ? {
          servers: {
            sequrai: {
              type: "http",
              ...httpServer(apiKey, apiUrl),
            },
          },
        }
      : client === "claude"
        ? { mcpServers: { sequrai: claudeHttpServer(apiKey, apiUrl) } }
        : { mcpServers: { sequrai: httpServer(apiKey, apiUrl) } };

  return JSON.stringify(config, null, 2);
}
