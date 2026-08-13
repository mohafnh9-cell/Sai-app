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

/** HTTP transport with API key — Claude Code and VS Code. */
function httpServer(apiKey: string, apiUrl: string) {
  return {
    type: "http" as const,
    url: getMcpEndpoint(apiUrl),
    headers: authHeaders(apiKey),
  };
}

/** Stdio bridge — Cursor only (HTTP URL alone does not work reliably in Cursor). */
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
      ? { servers: { sequrai: httpServer(apiKey, apiUrl) } }
      : client === "claude"
        ? { mcpServers: { sequrai: httpServer(apiKey, apiUrl) } }
        : { mcpServers: { sequrai: stdioServer(apiKey, apiUrl) } };

  return JSON.stringify(config, null, 2);
}

/** One terminal command — installs stdio bridge for Cursor and HTTP+key for Claude Code. */
export function buildMcpUniversalInstallCommand(apiKey: string, apiUrl: string): string {
  const installerUrl = `${apiUrl.replace(/\/$/, "")}/mcp/install.mjs`;
  const escapedKey = apiKey.replace(/"/g, '\\"');
  return `curl -fsSL "${installerUrl}" -o .sequrai-mcp-install.mjs && node .sequrai-mcp-install.mjs --key "${escapedKey}" && rm .sequrai-mcp-install.mjs`;
}

/** Claude Code CLI — HTTP transport with Bearer API key (no OAuth client id). */
export function buildMcpClaudeCliCommand(apiKey: string, apiUrl: string): string {
  const endpoint = getMcpEndpoint(apiUrl);
  const header = buildMcpAuthorizationHeader(apiKey).replace(/"/g, '\\"');
  return `claude mcp add --transport http sequrai ${endpoint} --header "Authorization: ${header}"`;
}

export function buildMcpManualSetup(apiKey: string, apiUrl: string) {
  return {
    url: getMcpEndpoint(apiUrl),
    authorization: buildMcpAuthorizationHeader(apiKey),
  };
}
