import { describe, expect, it } from "vitest";
import {
  buildMcpAuthorizationHeader,
  buildMcpClientConfig,
  buildMcpCursorInstallLink,
  buildMcpManualSetup,
  buildMcpUniversalInstallCommand,
  getMcpEndpoint,
} from "../client-config";

const KEY = "seq_live_test-secret";
const URL = "https://sequrai.example.com";

describe("MCP client configuration", () => {
  it.each(["cursor", "claude"] as const)(
    "generates a complete %s HTTP configuration without local bridge paths",
    (client) => {
      const config = JSON.parse(buildMcpClientConfig(client, KEY, URL));
      const server = config.mcpServers.sequrai;
      expect(server.url).toBe("https://sequrai.example.com/api/mcp");
      expect(server.headers.Authorization).toBe(`Bearer ${KEY}`);
      expect(JSON.stringify(config)).not.toContain("stdio-bridge");
      expect(JSON.stringify(config)).not.toContain("your-key-here");
      expect(JSON.stringify(config)).not.toContain("/path/to/");
      if (client === "claude") {
        expect(server.type).toBe("http");
      } else {
        expect(server.type).toBeUndefined();
      }
    }
  );

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

  it("builds a Cursor install deeplink", () => {
    const link = buildMcpCursorInstallLink(KEY, URL);
    expect(link.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?name=sequrai&config=")).toBe(
      true
    );
  });
});
