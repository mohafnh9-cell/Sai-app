import { describe, expect, it } from "vitest";
import {
  buildMcpClaudeCliCommand,
  buildMcpClientConfig,
  buildMcpEnvExportCommand,
  buildMcpManualSetup,
  buildMcpSourceEnvCommand,
  buildMcpUniversalInstallCommand,
  getMcpEndpoint,
} from "../client-config";

const KEY = "seq_live_test-secret";
const URL = "https://sequrai.example.com";

describe("MCP client configuration", () => {
  it("generates a Cursor stdio bridge configuration without embedded secrets", () => {
    const config = JSON.parse(buildMcpClientConfig("cursor", URL));
    const server = config.mcpServers.sequrai;
    expect(server.type).toBe("stdio");
    expect(server.command).toBe("node");
    expect(server.args[0]).toContain("stdio-bridge.mjs");
    expect(server.env.SEQURAI_API_URL).toBe("https://sequrai.example.com");
    expect(JSON.stringify(config)).not.toContain("seq_live_");
  });

  it("generates a Claude Code HTTP configuration with env-based Authorization", () => {
    const config = JSON.parse(buildMcpClientConfig("claude", URL));
    expect(config.mcpServers.sequrai).toMatchObject({
      type: "http",
      url: "https://sequrai.example.com/api/mcp",
      headers: {
        Authorization: "Bearer ${SEQURAI_API_KEY}",
      },
    });
  });

  it("generates the VS Code HTTP servers shape", () => {
    const config = JSON.parse(buildMcpClientConfig("vscode", URL));
    expect(config.servers.sequrai).toMatchObject({
      type: "http",
      url: "https://sequrai.example.com/api/mcp",
      headers: {
        Authorization: "Bearer ${SEQURAI_API_KEY}",
      },
    });
  });

  it("exposes secure manual setup values", () => {
    expect(getMcpEndpoint(URL)).toBe("https://sequrai.example.com/api/mcp");
    expect(buildMcpManualSetup(URL)).toEqual({
      url: "https://sequrai.example.com/api/mcp",
      authorization: "Bearer ${SEQURAI_API_KEY}",
      envFile: ".sequrai/mcp.env",
    });
  });

  it("builds install commands without embedding the API key", () => {
    const command = buildMcpUniversalInstallCommand(URL);
    expect(command).toContain("https://sequrai.example.com/mcp/install.mjs");
    expect(command).not.toContain("--key");
    expect(command).not.toContain("seq_live_");
  });

  it("builds a separate env export command", () => {
    expect(buildMcpEnvExportCommand(KEY)).toBe(`export SEQURAI_API_KEY="${KEY}"`);
  });

  it("builds source env helper", () => {
    expect(buildMcpSourceEnvCommand()).toBe("source .sequrai/mcp.env");
  });

  it("builds a Claude Code CLI command referencing sourced env", () => {
    const command = buildMcpClaudeCliCommand(URL);
    expect(command).toContain("source .sequrai/mcp.env");
    expect(command).toContain("claude mcp add --transport http sequrai");
    expect(command).not.toContain("seq_live_");
  });
});
