import type { BenchmarkCase } from "../../types";

/**
 * MCP-server-specific checks (features/security-analysis/mcp/rules.ts).
 * IMPORTANT: Finding.ruleId for these is `agent-scanner.scan_mcp_server.<internal-id>`
 * (e.g. "agent-scanner.scan_mcp_server.mcp.eval-usage"), NOT the bare
 * internal check id and NOT the wrapper ScanRule id "mcp.security" --
 * verified empirically against the real scanRepository() output; the
 * prefix comes from normalizeExternalFinding()'s toSequraiRuleId()
 * (features/security-analysis/normalize-external-finding.ts), which every
 * finding from the mcp/agent-action/prompt-injection subsystem passes
 * through. Fixture paths must contain "mcp" or "mcp-server"
 * (features/security-analysis/mcp/discover.ts::isMcpRelatedPath) and must
 * NOT fall under features/security-analysis/mcp/ or server/mcp/, which
 * are skipped as SequrAI's own detector/first-party source.
 */
export const MCP_POSITIVE_CASES: BenchmarkCase[] = [
  {
    id: "mcp.eval-usage-positive-01",
    ruleId: "agent-scanner.scan_mcp_server.mcp.eval-usage",
    expected: "detect",
    category: "mcp",
    language: "typescript",
    kind: "positive",
    source: "benchmark-new",
    description: "A discovered third-party MCP server tool handler calls eval() on tool input.",
    files: [{ path: "integrations/customer-mcp-server/tools.ts", content: "const result = eval(toolInput);" }],
  },
  {
    id: "mcp.cors-wildcard-positive-01",
    ruleId: "agent-scanner.scan_mcp_server.mcp.cors-wildcard",
    expected: "detect",
    category: "mcp",
    language: "typescript",
    kind: "positive",
    source: "benchmark-new",
    description: "A discovered MCP server enables CORS with a wildcard origin.",
    files: [{ path: "integrations/customer-mcp-server/server.ts", content: "app.use(cors({ origin: '*' }));" }],
  },
  {
    id: "mcp.spawn-shell-true-positive-01",
    ruleId: "agent-scanner.scan_mcp_server.mcp.spawn-shell-true",
    expected: "detect",
    category: "mcp",
    language: "typescript",
    kind: "positive",
    source: "benchmark-new",
    description: "A discovered MCP server spawns a subprocess with shell:true.",
    files: [{ path: "integrations/customer-mcp-server/tools.ts", content: "spawn(cmd, args, { shell: true });" }],
  },
];
