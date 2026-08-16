import { describe, expect, it } from "vitest";
import { resolveMcpProject } from "@/server/mcp/project-resolution";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { testOAuthMcpAuthContext } from "@/server/mcp/__tests__/test-context";

const ORG_A = "org-a";
const ORG_B = "org-b";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

describe("OAuth tenant isolation", () => {
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

  const ctx = testOAuthMcpAuthContext(admin, {
    organizationId: ORG_A,
    userId: "user-a",
    scopes: ["mcp:status:read"],
  });

  const t = getMcpTranslator("en");

  it("denies OAuth token access to project in another organization", async () => {
    await expect(
      resolveMcpProject(ctx, { projectId: PROJECT_B }, t)
    ).rejects.toMatchObject({
      code: "project_not_found",
    });
  });
});
