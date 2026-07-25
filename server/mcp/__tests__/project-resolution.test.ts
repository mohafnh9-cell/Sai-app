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
});
