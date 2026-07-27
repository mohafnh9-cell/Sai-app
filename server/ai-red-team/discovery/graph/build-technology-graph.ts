import type { DetectedTechnology, TechnologyGraph } from "../types";

const STACK_EDGES: Array<[string, string, string]> = [
  ["nextjs", "react", "framework_uses"],
  ["nextjs", "authjs", "integrates"],
  ["nextjs", "nextauth", "integrates"],
  ["nextjs", "clerk", "integrates"],
  ["nextjs", "vercel", "deploys_on"],
  ["authjs", "nextauth", "alias_of"],
  ["prisma", "postgresql", "orm_connects"],
  ["prisma", "mysql", "orm_connects"],
  ["prisma", "sqlite", "orm_connects"],
  ["drizzle", "postgresql", "orm_connects"],
  ["drizzle", "mysql", "orm_connects"],
  ["drizzle", "sqlite", "orm_connects"],
  ["openai", "vercel-ai-sdk", "used_via"],
  ["anthropic", "vercel-ai-sdk", "used_via"],
  ["google-gemini", "vercel-ai-sdk", "used_via"],
  ["supabase", "postgresql", "hosted_on"],
  ["nestjs", "express", "built_on"],
  ["docker", "vercel", "containerizes_for"],
  ["mcp-server", "vercel-ai-sdk", "exposes_tools"],
];

export function buildTechnologyGraph(technologies: DetectedTechnology[]): TechnologyGraph {
  const byId = new Map(technologies.map((t) => [t.id, t]));
  const nodes = technologies.map((t) => ({
    id: t.id,
    label: t.name,
    category: t.category,
  }));

  const edges = STACK_EDGES.filter(([from, to]) => byId.has(from) && byId.has(to)).map(
    ([from, to, relation]) => ({ from, to, relation })
  );

  if (byId.has("nextjs") && byId.has("stripe")) {
    edges.push({ from: "nextjs", to: "stripe", relation: "integrates" });
  }
  if (byId.has("nextjs") && byId.has("openai")) {
    edges.push({ from: "nextjs", to: "openai", relation: "integrates" });
  }
  if (byId.has("prisma") && byId.has("stripe")) {
    edges.push({ from: "prisma", to: "stripe", relation: "data_for" });
  }

  return { nodes, edges };
}
