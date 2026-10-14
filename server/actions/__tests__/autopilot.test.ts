import { beforeEach, describe, expect, it, vi } from "vitest";

// The autopilot switch wrote to "the user's first membership". It must write to the workspace the settings page SHOWS, only if it is
// still the active one, and write nothing otherwise.
vi.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`redirect:${p}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const state = vi.hoisted(() => ({
  member: new Set<string>(["org-a", "org-b"]),
  active: "org-a" as string | null,
  updates: [] as Array<{ id: string; values: Record<string, unknown> }>,
}));
vi.mock("@/server/workspaces/service", () => ({
  assertWorkspaceMembership: async (_s: unknown, _u: unknown, ws: string) => state.member.has(ws),
  resolveActiveWorkspaceIdForUser: async () => state.active,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({
      update: (values: Record<string, unknown>) => ({ eq: async (_c: string, id: string) => { state.updates.push({ id, values }); return { error: null }; } }),
    }),
  }),
}));

import { setVerdictAutopilotEnabledAction } from "../autopilot";

beforeEach(() => { state.member = new Set(["org-a", "org-b"]); state.active = "org-a"; state.updates = []; });

describe("setVerdictAutopilotEnabledAction", () => {
  it("writes to the workspace that is shown (and active), even if the user belongs to others", async () => {
    state.active = "org-b";
    const r = await setVerdictAutopilotEnabledAction("org-b", false);
    expect(r.error).toBeNull();
    expect(state.updates).toEqual([expect.objectContaining({ id: "org-b" })]);
  });
  it("stale tab (shows org-a, another tab switched to org-b): rejected, nothing written, no switch", async () => {
    state.active = "org-b";
    const r = await setVerdictAutopilotEnabledAction("org-a", true);
    expect(r).toMatchObject({ code: "workspace_context_mismatch", activeWorkspaceId: "org-b" });
    expect(state.updates).toHaveLength(0);
  });
  it("a workspace the user does not belong to: rejected, nothing written", async () => {
    const r = await setVerdictAutopilotEnabledAction("org-x", true);
    expect(r.code).toBe("workspace_access_denied");
    expect(state.updates).toHaveLength(0);
  });
});
