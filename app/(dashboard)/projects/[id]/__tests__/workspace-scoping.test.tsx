import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// next/navigation: notFound/redirect throw, like the real ones
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

type Ctx = { user: { id: string } | null; activeOrg: string | null };
const ctx: Ctx = { user: { id: "user-1" }, activeOrg: "org-A" };
let tables: Record<string, unknown[]> = {};
const lookups: Array<{ table: string }> = [];

vi.mock("@/lib/supabase/server", async () => {
  const { createFakeAdmin } = await import("@/server/mcp/__tests__/fake-admin");
  return {
    createClient: async () => {
      const fake = createFakeAdmin(tables as never) as unknown as { from: (t: string) => unknown };
      return {
        auth: { getUser: async () => ({ data: { user: ctx.user } }) },
        // RLS stand-in: the user is a member of BOTH workspaces, so the row is visible whenever the filters match
        from: (table: string) => {
          lookups.push({ table });
          return fake.from(table);
        },
      };
    },
  };
});

vi.mock("@/lib/server/request-cache", async () => {
  const { createFakeAdmin } = await import("@/server/mcp/__tests__/fake-admin");
  return {
    getCachedServerAuthContext: async () =>
      ctx.user
        ? {
            user: ctx.user,
            organizationId: ctx.activeOrg,
            supabase: createFakeAdmin(tables as never),
          }
        : null,
  };
});

vi.mock("@/lib/i18n/server", () => ({
  getTranslator: async () => ({ t: (k: string) => k, locale: "en" }),
}));
vi.mock("@/server/feature-flags", () => ({ isFeatureEnabled: () => false }));
vi.mock("@/server/production-journey/service", () => ({ getProductionJourneyByProject: async () => null }));
vi.mock("@/server/review-cancel/get-production-review-state", () => ({
  getProductionReviewState: async () => ({ hasActiveReview: false }),
}));
vi.mock("@/server/security-scanner/admin-client", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/server/analysis-runs/resolve-analysis-run", () => ({
  resolveAnalysisRunForProject: async () => ({ runId: null, valid: true }),
}));

import ProjectJourneyPage from "../journey/page";
import EditProjectPage, { generateMetadata as editMetadata } from "../edit/page";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const projectRow = (id: string, org: string) => ({ id, organization_id: org, name: `proj-${org}`, github_repo: "o/r", framework: "next" });

const journey = () => ProjectJourneyPage({ params: Promise.resolve({ id: PROJECT }), searchParams: Promise.resolve({}) });
const edit = () => EditProjectPage({ params: Promise.resolve({ id: PROJECT }) });

beforeEach(() => {
  ctx.user = { id: "user-1" };
  ctx.activeOrg = "org-A";
  lookups.length = 0;
  tables = {
    projects: [projectRow(PROJECT, "org-A"), projectRow(OTHER, "org-B")],
    scans: [],
    organization_members: [
      { user_id: "user-1", organization_id: "org-A" },
      { user_id: "user-1", organization_id: "org-B" },
    ],
  };
});

describe.each([
  ["Journey", journey],
  ["Edit", edit],
] as const)("%s page: ACTIVE WORKSPACE -> PROJECT scoping (Phase 8I.2.2)", (_name, render) => {
  it("A. project belongs to the active workspace: it resolves", async () => {
    await expect(render()).resolves.toBeTruthy();
  });

  it("B. project belongs to another workspace: it does not resolve under the current workspace", async () => {
    tables.projects = [projectRow(PROJECT, "org-B")];
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("C. the user is a member of the project's workspace but it is NOT active: still not rendered (the original bug)", async () => {
    tables.projects = [projectRow(PROJECT, "org-B")];
    ctx.activeOrg = "org-A";
    expect(tables.organization_members).toContainEqual({ user_id: "user-1", organization_id: "org-B" });
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("C'. switching the active workspace to the project's workspace renders it again", async () => {
    tables.projects = [projectRow(PROJECT, "org-B")];
    ctx.activeOrg = "org-B";
    await expect(render()).resolves.toBeTruthy();
  });

  it("D. no authenticated user: existing behavior (redirect to /login) is unchanged", async () => {
    ctx.user = null;
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("no active workspace: fails closed (not found), never an unfiltered lookup", async () => {
    ctx.activeOrg = null;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("Edit page metadata does not title a page with another workspace's project", () => {
  const meta = () => editMetadata({ params: Promise.resolve({ id: PROJECT }) });

  it("active workspace owns the project: its name is used", async () => {
    await expect(meta()).resolves.toEqual({ title: "Edit proj-org-A" });
  });

  it("project of a non-active workspace: generic title, no name", async () => {
    tables.projects = [projectRow(PROJECT, "org-B")];
    await expect(meta()).resolves.toEqual({ title: "Edit Project" });
  });
});
