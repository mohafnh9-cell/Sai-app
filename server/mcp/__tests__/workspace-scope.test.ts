import { describe, expect, it } from "vitest";
import { assertProjectInOrg } from "@/server/mcp/auth";
import { resolveMcpProject } from "@/server/mcp/project-resolution";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { createFakeAdmin } from "./fake-admin";
import { testMcpAuthContext } from "./test-context";

const ORG_A = "org-a";
const ORG_B = "org-b";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

describe("MCP workspace scope", () => {
  const admin = createFakeAdmin({
    projects: [
      {
        id: PROJECT_B,
        organization_id: ORG_B,
        name: "Beta",
        github_repo: "https://github.com/acme/beta",
        created_at: "2026-01-01",
      },
    ],
  });

  const ctx = testMcpAuthContext(admin, {
    keyId: "key-a",
    organizationId: ORG_A,
    userId: "user-a",
  });

  const t = getMcpTranslator("en");

  it("denies access to a project outside the key Workspace", async () => {
    await expect(assertProjectInOrg(admin as never, ORG_A, PROJECT_B)).rejects.toMatchObject({
      code: "project_not_found",
    });
  });

  it("denies MCP project resolution for another Workspace project id", async () => {
    await expect(
      resolveMcpProject(ctx, { projectId: PROJECT_B }, t)
    ).rejects.toMatchObject({
      code: "project_not_found",
    });
  });
});
