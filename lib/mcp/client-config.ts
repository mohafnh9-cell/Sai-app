export type McpClient = "cursor" | "claude" | "vscode";

export function getMcpEndpoint(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, "")}/api/mcp`;
}

export function buildMcpAuthorizationHeader(apiKey: string): string {
  return `Bearer ${apiKey}`;
}

function authHeaders(apiKey: string) {
  return { Authorization: buildMcpAuthorizationHeader(apiKey) };
}

/** HTTP transport — works from any project; no local bridge script required. */
function httpServer(apiKey: string, apiUrl: string) {
  return {
    url: getMcpEndpoint(apiUrl),
    headers: authHeaders(apiKey),
  };
}

function claudeHttpServer(apiKey: string, apiUrl: string) {
  return {
    type: "http" as const,
    url: getMcpEndpoint(apiUrl),
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

/** One terminal command — installs stdio bridge and configures Cursor globally. */
export function buildMcpUniversalInstallCommand(apiKey: string, apiUrl: string): string {
  const installerUrl = `${apiUrl.replace(/\/$/, "")}/mcp/install.mjs`;
  const escapedKey = apiKey.replace(/"/g, '\\"');
  return `curl -fsSL "${installerUrl}" -o .sequrai-mcp-install.mjs && node .sequrai-mcp-install.mjs --key "${escapedKey}" && rm .sequrai-mcp-install.mjs`;
}

export function buildMcpManualSetup(apiKey: string, apiUrl: string) {
  return {
    url: getMcpEndpoint(apiUrl),
    authorization: buildMcpAuthorizationHeader(apiKey),
  };
}
