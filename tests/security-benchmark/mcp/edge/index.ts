import type { BenchmarkCase } from "../../types";

/**
 * FIXED in the Detection Accuracy Hardening V1 pass (was a confirmed
 * false positive in V2): mcp.fs-write-no-path-validation's pattern was
 *   /\b(writeFileSync|writeFile|createWriteStream|appendFileSync|appendFile)\s*\(\s*[a-zA-Z_$][\w$.]*(?!\s*(?:path\.resolve|path\.join|path\.normalize))/g
 * The intent is "don't flag a write whose path argument is
 * path.resolve/join/normalize(...)", but `[\w$.]*` (the "identifier"
 * being matched) allows dots, so it greedily consumed the literal text
 * "path.resolve" as part of the "identifier" itself, leaving nothing for
 * the negative lookahead to compare against -- so the lookahead
 * trivially succeeded and the exclusion never actually excluded
 * anything. Fixed (features/security-analysis/mcp/rules.ts) by moving
 * the exclusion check to BEFORE the identifier is consumed:
 * `\(\s*(?!(?:path\.resolve|path\.join|path\.normalize)\s*\()[a-zA-Z_$][\w$.]*`
 * -- the same before-the-match placement mcp.url-no-validation already
 * used correctly. These fixtures now pass as genuine TN and are kept in
 * the hard regression gate to protect the fix permanently.
 */
export const MCP_EDGE_CASES: BenchmarkCase[] = [
  {
    id: "mcp.fs-write-no-path-validation-edge-resolved-path-01",
    ruleId: "agent-scanner.scan_mcp_server.mcp.fs-write-no-path-validation",
    expected: "no_detect",
    category: "mcp",
    language: "typescript",
    kind: "edge",
    source: "benchmark-new",
    description: "writeFileSync() is called with an already-path.resolve()-validated argument -- the rule's own recommended remediation.",
    files: [{ path: "integrations/customer-mcp-server/tools.ts", content: "writeFileSync(path.resolve(base, userPath), data);" }],
  },
  {
    id: "mcp.fs-write-no-path-validation-edge-normalized-path-01",
    ruleId: "agent-scanner.scan_mcp_server.mcp.fs-write-no-path-validation",
    expected: "no_detect",
    category: "mcp",
    language: "typescript",
    kind: "edge",
    source: "benchmark-new",
    description: "writeFileSync() with a path.normalize()-validated argument -- the other half of the fixed exclusion.",
    files: [{ path: "integrations/customer-mcp-server/tools.ts", content: "writeFileSync(path.normalize(userPath), data);" }],
  },
  {
    id: "mcp.fs-write-no-path-validation-edge-joined-path-01",
    ruleId: "agent-scanner.scan_mcp_server.mcp.fs-write-no-path-validation",
    expected: "no_detect",
    category: "mcp",
    language: "typescript",
    kind: "edge",
    source: "benchmark-new",
    description: "writeFileSync() with a path.join()-validated argument -- the third half of the fixed exclusion.",
    files: [{ path: "integrations/customer-mcp-server/tools.ts", content: "writeFileSync(path.join(base, userPath), data);" }],
  },
];
