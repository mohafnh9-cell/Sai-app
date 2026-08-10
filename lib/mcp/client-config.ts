export type McpClient = "cursor" | "claude" | "vscode";

function stdioServer(apiKey: string, apiUrl: string) {
  return {
    command: "node",
    args: ["${workspaceFolder}/mcp/stdio-bridge.mjs"],
    env: {
      SEQURAI_API_KEY: apiKey,
      SEQURAI_API_URL: apiUrl,
    },
  };
}

export function buildMcpClientConfig(
  client: McpClient,
  apiKey: string,
  apiUrl: string
): string {
  const server = stdioServer(apiKey, apiUrl);
  const config =
    client === "vscode"
      ? { servers: { sequrai: { type: "stdio", ...server } } }
      : { mcpServers: { sequrai: server } };
  return JSON.stringify(config, null, 2);
}
