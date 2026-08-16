import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const localAnalysisRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);

const localModules = [
  "workspace.ts",
  "local-tool-handlers.ts",
  "run-local-verdict.ts",
  "format-local-response.ts",
];

describe("Local MCP isolation from GitHub App", () => {
  it("local-analysis modules do not import GitHub App credential paths", () => {
    for (const file of localModules) {
      const source = readFileSync(resolve(localAnalysisRoot, file), "utf8");
      expect(source).not.toMatch(/github-app|resolveGitHubCredential|installation-token/);
    }
  });
});
