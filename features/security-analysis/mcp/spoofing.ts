const KNOWN_MCP_TOOLS = new Set([
  "readFile",
  "writeFile",
  "editFile",
  "createFile",
  "deleteFile",
  "listDirectory",
  "makeDirectory",
  "moveFile",
  "copyFile",
  "readMultipleFiles",
  "listFiles",
  "bash",
  "execute",
  "runCommand",
  "runScript",
  "search",
  "grep",
  "find",
  "glob",
  "fetch",
  "browse",
  "webSearch",
  "httpRequest",
  "gitStatus",
  "gitDiff",
  "gitCommit",
  "gitLog",
  "gitAdd",
  "remember",
  "recall",
  "storeMemory",
  "searchMemory",
  "query",
  "executeQuery",
  "dbQuery",
  "think",
  "plan",
  "summarize",
  "analyze",
]);

export function levenshtein(a: string, b: string): number {
  if (a.length > 100 || b.length > 100) return 999;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function findSpoofedTool(
  toolName: string
): { spoofed: string; distance: number } | null {
  if (KNOWN_MCP_TOOLS.has(toolName)) return null;
  if (toolName.length < 6) return null;
  let best: string | null = null;
  let bestDist = 3;
  for (const known of KNOWN_MCP_TOOLS) {
    if (Math.abs(known.length - toolName.length) > 2) continue;
    const distance = levenshtein(toolName, known);
    if (distance < bestDist) {
      bestDist = distance;
      best = known;
    }
  }
  return best ? { spoofed: best, distance: bestDist } : null;
}
