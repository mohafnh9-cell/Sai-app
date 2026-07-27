import { describe, expect, it, beforeEach } from "vitest";
import {
  createDiscoveryEngine,
  detectTechnologies,
  buildTechnologyGraph,
  buildAttackSurface,
  resetDiscoveryCacheForTests,
} from "../index";
import type { DiscoveryRepositoryInput } from "../types";

const sequraiLikeRepo = (): DiscoveryRepositoryInput => ({
  projectId: "project-1",
  organizationId: "org-1",
  commitSha: "commit-a",
  files: [
    {
      path: "package.json",
      content: JSON.stringify({
        dependencies: {
          next: "16.2.10",
          react: "19.0.0",
          "@supabase/supabase-js": "2.0.0",
          "@anthropic-ai/sdk": "0.30.0",
          ai: "6.0.0",
          inngest: "3.0.0",
          stripe: "14.0.0",
          "@prisma/client": "7.0.0",
          prisma: "7.0.0",
        },
        devDependencies: {
          vitest: "4.0.0",
        },
      }),
    },
    { path: "prisma/schema.prisma", content: 'datasource db { provider = "postgresql" }' },
    { path: "mcp/server.ts", content: "export const MCP_TOOL_DEFINITIONS = [];" },
    { path: "vercel.json", content: "{}" },
    { path: ".github/workflows/ci.yml", content: "name: ci" },
  ],
});

describe("technology detection", () => {
  it("detects core stack technologies", () => {
    const detected = detectTechnologies(sequraiLikeRepo());
    const ids = detected.map((t) => t.id);
    expect(ids).toContain("nextjs");
    expect(ids).toContain("react");
    expect(ids).toContain("supabase");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("vercel-ai-sdk");
    expect(ids).toContain("stripe");
    expect(ids).toContain("prisma");
    expect(ids).toContain("postgresql");
    expect(ids).toContain("mcp-server");
    expect(ids).toContain("github-actions");
  });
});

describe("graph and attack surface", () => {
  it("builds a technology graph with edges", () => {
    const technologies = detectTechnologies(sequraiLikeRepo());
    const graph = buildTechnologyGraph(technologies);
    expect(graph.nodes.length).toBeGreaterThan(3);
    expect(graph.edges.some((e) => e.from === "nextjs" && e.to === "react")).toBe(true);
  });

  it("infers attack surface areas without performing attacks", () => {
    const repo = sequraiLikeRepo();
    const technologies = detectTechnologies(repo);
    const surface = buildAttackSurface(technologies, repo);
    const areas = surface.map((s) => s.area);
    expect(areas).toContain("rest_api");
    expect(areas).toContain("browser");
    expect(areas).toContain("payments");
    expect(areas).toContain("llm");
    expect(areas).toContain("mcp_servers");
  });
});

describe("DiscoveryEngine caching", () => {
  beforeEach(() => {
    resetDiscoveryCacheForTests();
  });

  it("returns cached report for the same commit", async () => {
    const engine = createDiscoveryEngine();
    const repo = sequraiLikeRepo();
    const first = await engine.discover(repo);
    const second = await engine.discover(repo);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.reportId).toBe(first.reportId);
  });

  it("recomputes when commit changes", async () => {
    const engine = createDiscoveryEngine();
    const first = await engine.discover(sequraiLikeRepo());
    const second = await engine.discover({ ...sequraiLikeRepo(), commitSha: "commit-b" });
    expect(second.cached).toBe(false);
    expect(second.reportId).not.toBe(first.reportId);
  });
});

describe("DiscoveryReport serialization", () => {
  it("serializes to JSON", async () => {
    const report = await createDiscoveryEngine().discover({
      ...sequraiLikeRepo(),
      skipCache: true,
    });
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json) as typeof report;
    expect(parsed.confidenceScore).toBeGreaterThan(0);
    expect(parsed.potentialAttackSurface.length).toBeGreaterThan(0);
  });
});
