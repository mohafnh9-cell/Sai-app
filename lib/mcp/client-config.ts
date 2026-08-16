export type McpClient = "cursor" | "claude" | "vscode";
export type McpInstallScope = "project" | "global";

export const SEQURAI_STDIO_BRIDGE_PATH = "~/.sequrai/stdio-bridge.mjs";
export const SEQURAI_ENV_FILE = ".sequrai/mcp.env";

export function getMcpEndpoint(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, "")}/api/mcp`;
}

export function buildMcpAuthorizationHeader(apiKey: string): string {
  return `Bearer ${apiKey}`;
}

/** Secure env export — run before the install command. Never embed the key in curl/node args. */
export function buildMcpEnvExportCommand(apiKey: string): string {
  const escapedKey = apiKey.replace(/"/g, '\\"');
  return `export SEQURAI_API_KEY="${escapedKey}"`;
}

function authHeadersEnvRef() {
  return { Authorization: "Bearer ${SEQURAI_API_KEY}" };
}

/** HTTP transport with env-based Authorization — Claude Code and VS Code. */
function httpServer(apiUrl: string) {
  return {
    type: "http" as const,
    url: getMcpEndpoint(apiUrl),
    headers: authHeadersEnvRef(),
  };
}

/** Stdio bridge — Cursor (local + remote tools). Key loaded from .sequrai/mcp.env. */
function stdioServer(apiUrl: string, bridgePath = SEQURAI_STDIO_BRIDGE_PATH) {
  return {
    type: "stdio" as const,
    command: "node",
    args: [bridgePath],
    env: {
      SEQURAI_API_URL: apiUrl.replace(/\/$/, ""),
    },
  };
}

export function buildMcpClientConfig(
  client: McpClient,
  apiUrl: string
): string {
  const config =
    client === "vscode"
      ? { servers: { sequrai: httpServer(apiUrl) } }
      : client === "claude"
        ? { mcpServers: { sequrai: httpServer(apiUrl) } }
        : { mcpServers: { sequrai: stdioServer(apiUrl) } };

  return JSON.stringify(config, null, 2);
}

/** Install command — key must be exported separately via buildMcpEnvExportCommand. */
export function buildMcpUniversalInstallCommand(apiUrl: string, scope: McpInstallScope = "project"): string {
  const installerUrl = `${apiUrl.replace(/\/$/, "")}/mcp/install.mjs`;
  const scopeFlag = scope === "global" ? " --scope global" : "";
  return `curl -fsSL "${installerUrl}" -o .sequrai-mcp-install.mjs && node .sequrai-mcp-install.mjs${scopeFlag} && rm .sequrai-mcp-install.mjs`;
}

/** Claude Code CLI — requires SEQURAI_API_KEY in the shell environment. */
export function buildMcpClaudeCliCommand(apiUrl: string): string {
  const endpoint = getMcpEndpoint(apiUrl);
  return `source .sequrai/mcp.env && claude mcp add --transport http sequrai ${endpoint} --header "Authorization: Bearer \${SEQURAI_API_KEY}"`;
}

export function buildMcpManualSetup(apiUrl: string) {
  return {
    url: getMcpEndpoint(apiUrl),
    authorization: "Bearer ${SEQURAI_API_KEY}",
    envFile: SEQURAI_ENV_FILE,
  };
}

export function buildMcpSourceEnvCommand(): string {
  return `source ${SEQURAI_ENV_FILE}`;
}
