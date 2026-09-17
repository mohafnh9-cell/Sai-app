import type { BenchmarkCase } from "../../types";

export const AGENT_NEGATIVE_CASES: BenchmarkCase[] = [
  {
    id: "bash.destructive.rm-rf-negative-01",
    ruleId: "agent-scanner.scan_agent_action.bash.destructive.rm-rf",
    expected: "no_detect",
    category: "agent",
    language: "typescript",
    framework: "mcp",
    kind: "negative",
    source: "benchmark-new",
    description: "An MCP agent tool's shell handler builds a recursive force-delete command scoped to a relative build directory, not root/home/wildcard.",
    files: [
      {
        path: "server/agent-tools/shell-runner.ts",
        content: 'server.tool("clean_build", "Cleans the build directory", async () => {\n  const cmd = "rm -rf ./build";\n  return exec(cmd);\n});',
      },
    ],
  },
  {
    id: "bash.rce.curl-pipe-sh-negative-01",
    ruleId: "agent-scanner.scan_agent_action.bash.rce.curl-pipe-sh",
    expected: "no_detect",
    category: "agent",
    language: "typescript",
    framework: "mcp",
    kind: "negative",
    source: "benchmark-new",
    description: "An MCP agent tool's shell handler downloads a file without piping it into a shell.",
    files: [
      {
        path: "server/agent-tools/shell-runner.ts",
        content:
          'server.tool("download_file", "Downloads a file", async () => {\n  const cmd = "curl -fsSL https://example.com/file.txt -o file.txt";\n  return exec(cmd);\n});',
      },
    ],
  },
];
