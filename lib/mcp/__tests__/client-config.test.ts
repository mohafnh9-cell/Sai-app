import { describe, expect, it } from "vitest";
import {
  buildMcpAuthorizationHeader,
  buildMcpClaudeCliCommand,
  buildMcpClientConfig,
  buildMcpManualSetup,
  buildMcpUniversalInstallCommand,
  getMcpEndpoint,
} from "../client-config";

const KEY = "seq_live_test-secret";
const URL = "https://sequrai.example.com";

describe("MCP client configuration", () => {
  it("generates a Cursor stdio bridge configuration", () => {
    const config = JSON.parse(buildMcpClientConfig("cursor", KEY, URL));
    const server = config.mcpServers.sequrai;
    expect(server.type).toBe("stdio");
    expect(server.command).toBe("node");
    expect(server.args[0]).toContain("stdio-bridge.mjs");
    expect(server.env.SEQURAI_API_KEY).toBe(KEY);
    expect(server.env.SEQURAI_API_URL).toBe("https://sequrai.example.com");
    expect(JSON.stringify(config)).not.toContain("your-key-here");
    expect(JSON.stringify(config)).not.toContain("/path/to/");
  });

  it("generates a Claude Code HTTP configuration with Bearer API key", () => {
    const config = JSON.parse(buildMcpClientConfig("claude", KEY, URL));
    expect(config.mcpServers.sequrai).toMatchObject({
      type: "http",
      url: "https://sequrai.example.com/api/mcp",
      headers: {
        Authorization: `Bearer ${KEY}`,
      },
    });
    expect(JSON.stringify(config)).not.toContain("stdio-bridge");
  });

  it("generates the VS Code HTTP servers shape", () => {
    const config = JSON.parse(buildMcpClientConfig("vscode", KEY, URL));
    expect(config.servers.sequrai).toMatchObject({
      type: "http",
      url: "https://sequrai.example.com/api/mcp",
      headers: {
        Authorization: `Bearer ${KEY}`,
      },
    });
    expect(JSON.stringify(config)).not.toContain("stdio-bridge");
  });

  it("exposes universal manual setup values", () => {
    expect(getMcpEndpoint(URL)).toBe("https://sequrai.example.com/api/mcp");
    expect(buildMcpAuthorizationHeader(KEY)).toBe(`Bearer ${KEY}`);
    expect(buildMcpManualSetup(KEY, URL)).toEqual({
      url: "https://sequrai.example.com/api/mcp",
      authorization: `Bearer ${KEY}`,
    });
  });

  it("builds a universal install command", () => {
    const command = buildMcpUniversalInstallCommand(KEY, URL);
    expect(command).toContain("https://sequrai.example.com/mcp/install.mjs");
    expect(command).toContain(`--key "${KEY}"`);
  });

  it("builds a Claude Code CLI command with Authorization header", () => {
    const command = buildMcpClaudeCliCommand(KEY, URL);
    expect(command).toContain("claude mcp add --transport http sequrai");
    expect(command).toContain("https://sequrai.example.com/api/mcp");
    expect(command).toContain(`Authorization: Bearer ${KEY}`);
  });
});
