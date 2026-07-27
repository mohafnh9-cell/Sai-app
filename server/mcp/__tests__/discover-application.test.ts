import { describe, expect, it, vi, beforeEach } from "vitest";
import { discoverApplication } from "../tools/discover-application";
import { getMcpTranslator } from "../i18n";
import type { McpAuthContext } from "../auth";

vi.mock("@/server/ai-red-team/discovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai-red-team/discovery")>();
  return {
    ...actual,
    loadDiscoveryRepositoryFromProject: vi.fn().mockResolvedValue({
      projectId: "project-1",
      organizationId: "org-1",
      commitSha: "abc1234",
      repositoryLabel: "sequrai-app",
      files: [
        {
          path: "package.json",
          content: JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } }),
        },
      ],
    }),
  };
});

function fakeCtx(): McpAuthContext {
  return {
    admin: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "project-1",
                    name: "sequrai-app",
                    github_repo: "https://github.com/acme/sequrai-app",
                  },
                }),
            }),
          }),
        }),
      }),
    } as never,
    organizationId: "org-1",
    userId: "user-1",
  };
}

describe("discover_application MCP tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns structured discovery output and summary", async () => {
    const t = getMcpTranslator("en");
    const result = await discoverApplication(fakeCtx(), { projectId: "project-1" }, t);
    expect(result.mode).toBe("application_discovery");
    expect(result.detectedTechnologyCount).toBeGreaterThan(0);
    expect(result.discovery.technologyGraph.nodes.length).toBeGreaterThan(0);
    expect(result.summary).toContain("APPLICATION DISCOVERY");
    expect(result.summary).toContain("Detected technologies");
  });
});
