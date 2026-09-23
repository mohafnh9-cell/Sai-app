import { describe, expect, it } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { resolveMcpProject } from "../project-resolution";

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";

const t = ((key: string) => key) as never;

describe("resolveMcpProject repository matching", () => {
  it("resolves owner/repo selectors against stored html_url", async () => {
    const admin = createFakeAdmin({
      projects: [
        {
          id: PROJECT,
          name: "sequrai-app",
          organization_id: ORG,
          github_repo: "https://github.com/mohafnh9-cell/sequrai-app",
        },
      ],
    });

    const resolved = await resolveMcpProject(
      { admin: admin as never, organizationId: ORG } as never,
      { repositoryFullName: "mohafnh9-cell/sequrai-app" },
      t
    );

    expect(resolved.repositoryFullName).toBe("https://github.com/mohafnh9-cell/sequrai-app");
  });

  it("normalizes malformed stored URLs in MCP responses", async () => {
    const admin = createFakeAdmin({
      projects: [
        {
          id: PROJECT,
          name: "sequrai-app",
          organization_id: ORG,
          github_repo: "https://github.com/mohafnh9-cell/mohafnh9-cell/sequrai-app",
        },
      ],
    });

    const resolved = await resolveMcpProject(
      { admin: admin as never, organizationId: ORG } as never,
      { projectId: PROJECT },
      t
    );

    expect(resolved.repositoryFullName).toBe("https://github.com/mohafnh9-cell/sequrai-app");
  });

  // Pass 3 CRIT-004: after a repository name is released and reused by a
  // different repository, the old lineage is preserved as its own project.
  // A name resolves to the newest lineage; the old one stays reachable by
  // explicit id as history and is never returned for the reused name.
  describe("a repository name reused by a different repository", () => {
    const OLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const NEW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const tables = () => ({
      projects: [
        {
          id: OLD,
          name: "repo",
          organization_id: ORG,
          github_repo: "https://github.com/acme/repo",
          github_repository_id: 100,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: NEW,
          name: "repo",
          organization_id: ORG,
          github_repo: "https://github.com/acme/repo",
          github_repository_id: 200,
          created_at: "2026-06-01T00:00:00.000Z",
        },
      ],
    });
    const ctx = () => ({ admin: createFakeAdmin(tables()) as never, organizationId: ORG }) as never;

    it("resolves the name to the newest project, never the old repository's", async () => {
      const resolved = await resolveMcpProject(ctx(), { repositoryFullName: "acme/repo" }, t);
      expect(resolved.id).toBe(NEW);
    });

    it("keeps the old project reachable by explicit id as history", async () => {
      const resolved = await resolveMcpProject(ctx(), { projectId: OLD }, t);
      expect(resolved.id).toBe(OLD);
    });
  });
});
