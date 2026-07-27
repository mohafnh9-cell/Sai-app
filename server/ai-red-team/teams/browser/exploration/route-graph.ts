export type RouteGraphNode = {
  id: string;
  route: string;
  classification: string;
  authState: "anonymous" | "authenticated" | "unknown";
};

export type RouteGraphEdge = {
  from: string;
  to: string;
  kind: "navigation" | "form_submit" | "redirect" | "blocked" | "error";
};

export type RouteGraph = {
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
};

export function normalizeRoutePath(path: string): string {
  if (!path.startsWith("/")) return `/${path}`;
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const normalizedQuery = new URLSearchParams(sorted).toString();
  return normalizedQuery ? `${pathname}?${normalizedQuery}` : pathname;
}

export class RouteGraphBuilder {
  private readonly nodes = new Map<string, RouteGraphNode>();
  private readonly edges: RouteGraphEdge[] = [];

  addNode(route: string, classification = "unknown", authState: RouteGraphNode["authState"] = "anonymous") {
    const normalized = normalizeRoutePath(route);
    if (!this.nodes.has(normalized)) {
      this.nodes.set(normalized, {
        id: normalized,
        route: normalized,
        classification,
        authState,
      });
    }
    return normalized;
  }

  addEdge(from: string, to: string, kind: RouteGraphEdge["kind"]) {
    const a = this.addNode(from);
    const b = this.addNode(to);
    this.edges.push({ from: a, to: b, kind });
  }

  build(): RouteGraph {
    return { nodes: [...this.nodes.values()], edges: [...this.edges] };
  }
}
