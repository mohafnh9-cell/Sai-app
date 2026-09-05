import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 31.2 (Task 3 follow-up): updateProjectAction/deleteProjectAction
 * relied entirely on RLS to block a cross-org write, but never checked
 * whether the update/delete actually affected a row -- an RLS-blocked
 * attempt (zero rows) had no `error` and redirected exactly like a real
 * success. These tests prove the zero-row case is now a real, visible
 * error, and that a genuine same-org write still succeeds and redirects.
 */

class RedirectSignal extends Error {
  constructor(public readonly path: string) {
    super("NEXT_REDIRECT");
  }
}

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new RedirectSignal(path);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  updateResult: [{ id: "proj-1" }] as Array<{ id: string }> | null,
  deleteResult: [{ id: "proj-1" }] as Array<{ id: string }> | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: state.user } })) },
    from: (_table: string) => ({
      update: () => ({
        eq: () => ({
          select: async () => ({ data: state.updateResult, error: null }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          select: async () => ({ data: state.deleteResult, error: null }),
        }),
      }),
    }),
  })),
}));

import { deleteProjectAction, updateProjectAction } from "../projects";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("updateProjectAction", () => {
  beforeEach(() => {
    state.user = { id: "user-1" };
    state.updateResult = [{ id: "proj-1" }];
  });

  it("redirects to the project on a real (same-org, RLS-permitted) update", async () => {
    await expect(updateProjectAction("proj-1", formData({ name: "New name", description: "", github_repo: "", production_url: "", framework: "OTHER" }))).rejects.toBeInstanceOf(
      RedirectSignal
    );
  });

  it("SECURITY: returns a real error instead of a silent success when the write affects zero rows (RLS-blocked cross-org attempt)", async () => {
    state.updateResult = [];
    const result = await updateProjectAction("proj-1", formData({ name: "New name", description: "", github_repo: "", production_url: "", framework: "OTHER" }));
    expect(result).toEqual({
      error: { _root: ["Project not found or you do not have access to update it."] },
    });
  });

  it("returns the same not-found error when the update result is null", async () => {
    state.updateResult = null;
    const result = await updateProjectAction("proj-1", formData({ name: "New name", description: "", github_repo: "", production_url: "", framework: "OTHER" }));
    expect(result).toMatchObject({ error: { _root: [expect.stringContaining("not found")] } });
  });
});

describe("deleteProjectAction", () => {
  beforeEach(() => {
    state.user = { id: "user-1" };
    state.deleteResult = [{ id: "proj-1" }];
  });

  it("redirects to /projects on a real (same-org, RLS-permitted) delete", async () => {
    await expect(deleteProjectAction("proj-1")).rejects.toBeInstanceOf(RedirectSignal);
  });

  it("SECURITY: returns a real error instead of a silent success when the delete affects zero rows (RLS-blocked cross-org attempt)", async () => {
    state.deleteResult = [];
    const result = await deleteProjectAction("proj-1");
    expect(result).toEqual({ error: "Project not found or you do not have access to delete it." });
  });
});
