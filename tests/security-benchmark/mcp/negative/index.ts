import type { BenchmarkCase } from "../../types";

export const MCP_NEGATIVE_CASES: BenchmarkCase[] = [
  {
    id: "mcp.eval-usage-negative-01",
    ruleId: "agent-scanner.scan_mcp_server.mcp.eval-usage",
    expected: "no_detect",
    category: "mcp",
    language: "typescript",
    kind: "negative",
    source: "benchmark-new",
    description: "A discovered MCP server tool handler parses input as structured JSON, no eval.",
    files: [{ path: "integrations/customer-mcp-server/tools.ts", content: "const result = JSON.parse(toolInput);" }],
  },
  {
    id: "mcp.cors-wildcard-negative-01",
    ruleId: "agent-scanner.scan_mcp_server.mcp.cors-wildcard",
    expected: "no_detect",
    category: "mcp",
    language: "typescript",
    kind: "negative",
    source: "benchmark-new",
    description: "A discovered MCP server restricts CORS to an explicit allowlist variable.",
    files: [{ path: "integrations/customer-mcp-server/server.ts", content: "app.use(cors({ origin: allowedOrigins }));" }],
  },
  {
    id: "mcp.spawn-shell-true-negative-01",
    ruleId: "agent-scanner.scan_mcp_server.mcp.spawn-shell-true",
    expected: "no_detect",
    category: "mcp",
    language: "typescript",
    kind: "negative",
    source: "benchmark-new",
    description: "A discovered MCP server spawns a subprocess with shell explicitly disabled.",
    files: [{ path: "integrations/customer-mcp-server/tools.ts", content: "spawn(cmd, args, { shell: false });" }],
  },
];
