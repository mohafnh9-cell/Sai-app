import type { BenchmarkCase } from "../../types";

/**
 * DISCOVERED FALSE POSITIVE #2 (V2, same bug CLASS as web.next-xss in V1):
 * mcp.fs-write-no-path-validation's pattern is
 *   /\b(writeFileSync|writeFile|createWriteStream|appendFileSync|appendFile)\s*\(\s*[a-zA-Z_$][\w$.]*(?!\s*(?:path\.resolve|path\.join|path\.normalize))/g
 * The intent is "don't flag a write whose path argument is
 * path.resolve/join/normalize(...)", but `[\w$.]*` (the "identifier"
 * being matched) allows dots, so it greedily consumes the literal text
 * "path.resolve" as part of the "identifier" itself, leaving nothing for
 * the negative lookahead to compare against at that position -- so the
 * lookahead trivially succeeds and the exclusion never actually excludes
 * anything. Verified directly:
 *   /\b(writeFileSync|writeFile|createWriteStream|appendFileSync|appendFile)\s*\(\s*[a-zA-Z_$][\w$.]*(?!\s*(?:path\.resolve|path\.join|path\.normalize))/g
 *     .test('writeFileSync(path.resolve(base, userPath), data);')
 *   // => true (should be false -- this IS the recommended safe pattern)
 * Recorded as a permanent negative fixture per the false-positive
 * workflow; `excludedReason` keeps it out of the hard regression gate.
 * Fixing the pattern is out of scope for this measurement-only phase.
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
    excludedReason:
      "Known false positive: the path.resolve/join/normalize exclusion lookahead is defeated because the preceding identifier match already consumes the dotted call text (see file docblock). Currently DOES flag this safe, recommended pattern.",
    description: "writeFileSync() is called with an already-path.resolve()-validated argument -- the rule's own recommended remediation.",
    files: [{ path: "integrations/customer-mcp-server/tools.ts", content: "writeFileSync(path.resolve(base, userPath), data);" }],
  },
];
