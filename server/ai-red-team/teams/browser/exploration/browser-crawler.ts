import type { SafeBrowserRuntime } from "../runtime/safe-browser-runtime";
import { RouteGraphBuilder, normalizeRoutePath } from "./route-graph";
import { isPathExcluded } from "./interaction-guard";
import type { ExecutionBudget } from "../runtime/execution-budget";

export type BrowserCrawlerResult = {
  routesExplored: number;
  graph: ReturnType<RouteGraphBuilder["build"]>;
};

export async function crawlSameOrigin(input: {
  runtime: SafeBrowserRuntime;
  entryPath: string;
  budget: ExecutionBudget;
  maxDepth: number;
  pathExclusions: string[];
}): Promise<BrowserCrawlerResult> {
  const graph = new RouteGraphBuilder();
  const queue: Array<{ path: string; depth: number }> = [{ path: input.entryPath, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0 && !input.budget.exhausted) {
    const current = queue.shift();
    if (!current) break;
    const normalized = normalizeRoutePath(current.path);
    if (visited.has(normalized) || current.depth > input.maxDepth) continue;
    if (isPathExcluded(normalized, input.pathExclusions)) continue;
    visited.add(normalized);

    await input.runtime.goto(normalized);
    input.budget.recordRoute();
    graph.addNode(normalized);
    const snap = await input.runtime.snapshot();
    for (const link of snap.links) {
      if (!link.startsWith("/")) continue;
      const child = normalizeRoutePath(link);
      graph.addEdge(normalized, child, "navigation");
      if (!visited.has(child)) {
        queue.push({ path: child, depth: current.depth + 1 });
      }
    }
  }

  return { routesExplored: visited.size, graph: graph.build() };
}
