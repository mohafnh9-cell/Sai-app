export type McpClient = "cursor" | "claude" | "vscode";

export const SEQURAI_STDIO_BRIDGE_PATH = "~/.sequrai/stdio-bridge.mjs";

export function getMcpEndpoint(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, "")}/api/mcp`;
}

export function buildMcpAuthorizationHeader(apiKey: string): string {
  return `Bearer ${apiKey}`;
}

function authHeaders(apiKey: string) {
  return { Authorization: buildMcpAuthorizationHeader(apiKey) };
}

/** HTTP transport — VS Code remote MCP only. */
function httpServer(apiKey: string, apiUrl: string) {
  return {
    url: getMcpEndpoint(apiUrl),
    headers: authHeaders(apiKey),
  };
}

/** Stdio bridge — required for Cursor and Claude Code (HTTP triggers OAuth client-id prompts). */
function stdioServer(apiKey: string, apiUrl: string, bridgePath = SEQURAI_STDIO_BRIDGE_PATH) {
  return {
    type: "stdio" as const,
    command: "node",
    args: [bridgePath],
    env: {
      SEQURAI_API_KEY: apiKey,
      SEQURAI_API_URL: apiUrl.replace(/\/$/, ""),
    },
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
      : { mcpServers: { sequrai: stdioServer(apiKey, apiUrl) } };

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
