import { describe, expect, it } from "vitest";
import { buildMcpClientConfig } from "../client-config";

const KEY = "seq_live_test-secret";
const URL = "https://sequrai.example.com";

describe("MCP client configuration", () => {
  it.each(["cursor", "claude"] as const)(
    "generates a complete %s configuration without manual placeholders",
    (client) => {
      const config = JSON.parse(buildMcpClientConfig(client, KEY, URL));
      expect(config.mcpServers.sequrai).toMatchObject({
        command: "node",
        env: {
          SEQURAI_API_KEY: KEY,
          SEQURAI_API_URL: URL,
        },
      });
      expect(JSON.stringify(config)).not.toContain("your-key-here");
      expect(JSON.stringify(config)).not.toContain("/path/to/");
    }
  );

  it("generates the VS Code servers shape", () => {
    const config = JSON.parse(buildMcpClientConfig("vscode", KEY, URL));
    expect(config.servers.sequrai).toMatchObject({
      type: "stdio",
      command: "node",
      env: {
        SEQURAI_API_KEY: KEY,
        SEQURAI_API_URL: URL,
      },
    });
  });
});
