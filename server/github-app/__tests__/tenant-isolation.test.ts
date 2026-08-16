import { describe, expect, it } from "vitest";
import { assertInstallationOwnsRepository } from "@/server/github-app/installation-events";

describe("assertInstallationOwnsRepository tenant isolation", () => {
  it("rejects when installation belongs to another organization", async () => {
    const admin = {
      from(table: string) {
        if (table === "github_app_installations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "inst-1",
                      organization_id: "org-b",
                      github_installation_id: 10,
                      status: "active",
                      revoked_at: null,
                    },
                  }),
                }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      },
    };

    const allowed = await assertInstallationOwnsRepository({
      admin: admin as never,
      organizationId: "org-a",
      installationRowId: "inst-1",
      githubRepositoryId: 123,
    });
    expect(allowed).toBe(false);
  });

  it("accepts when repository is linked to installation in same organization", async () => {
    const admin = {
      from(table: string) {
        if (table === "github_app_installations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "inst-1",
                      organization_id: "org-a",
                      github_installation_id: 10,
                      status: "active",
                      revoked_at: null,
                    },
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "github_app_installation_repositories") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    is: () => ({
                      maybeSingle: async () => ({ data: { id: "repo-link-1" } }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      },
    };

    const allowed = await assertInstallationOwnsRepository({
      admin: admin as never,
      organizationId: "org-a",
      installationRowId: "inst-1",
      githubRepositoryId: 123,
    });
    expect(allowed).toBe(true);
  });
});
