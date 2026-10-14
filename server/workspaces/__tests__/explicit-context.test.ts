import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const member = new Set(["a", "b"]);
vi.mock("@/server/workspaces/service", () => ({ assertWorkspaceMembership: async (_s: unknown, _u: unknown, ws: string) => member.has(ws) }));

import { guardShownWorkspace, requireExplicitWorkspace } from "../explicit-context";

const req = (shown?: string) => new Request("https://x/api/y", { method: "POST", headers: shown ? { "x-sequrai-workspace-id": shown } : {} });
const auth = (over: Partial<{ organizationId: string | null; bypass: boolean }> = {}) => ({ supabase: {} as never, user: { id: "u" }, organizationId: "a", bypass: false, ...over });

describe("requireExplicitWorkspace / guardShownWorkspace", () => {
  it("accepts the shown workspace when it is the active one", async () => {
    expect(await requireExplicitWorkspace(req("a"), {} as never, "u", "a")).toEqual({ ok: true, organizationId: "a" });
    expect(await guardShownWorkspace(req("a"), auth())).toBeNull();
  });
  it("rejects a different active workspace with 409 and the two ids, never switching", async () => {
    const r = await guardShownWorkspace(req("a"), auth({ organizationId: "b" }));
    expect(r?.status).toBe(409);
    expect(await r?.json()).toMatchObject({ code: "workspace_context_mismatch", requestedWorkspaceId: "a", activeWorkspaceId: "b" });
  });
  it("requires the header and a membership", async () => {
    expect((await guardShownWorkspace(req(), auth()))?.status).toBe(400);
    expect((await guardShownWorkspace(req("zzz"), auth({ organizationId: "zzz" })))?.status).toBe(403);
  });
  it("has nothing to protect in dev bypass or before a workspace exists", async () => {
    expect(await guardShownWorkspace(req(), auth({ bypass: true }))).toBeNull();
    expect(await guardShownWorkspace(req(), auth({ organizationId: null }))).toBeNull();
  });
});

// Coverage guard: a write handler that acts on "the active workspace" must state and check the shown workspace. Adding a new one without
// the check fails here; routes that legitimately work on the workspace itself or on the user are listed with the reason.
const ALLOWED_WITHOUT_CHECK: Record<string, string> = {
  "app/api/workspaces/route.ts": "creates a workspace (no current workspace to protect)",
  "app/api/workspaces/switch/route.ts": "is the switch itself",
  "app/api/workspaces/[workspaceId]/route.ts": "targets a workspace by id in the URL",
  "app/api/account/delete/route.ts": "acts on the user, not on a workspace",
};
function routes(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") routes(p, out); }
    else if (name === "route.ts") out.push(p);
  }
  return out;
}
describe("workspace-scoped writes state the shown workspace", () => {
  const writes = routes("app/api").filter((f) => {
    const s = readFileSync(f, "utf8");
    return /export async function (POST|PUT|PATCH|DELETE)\b/.test(s) && /getServerAuthContext|resolveActiveWorkspaceIdForUser/.test(s);
  });
  it("finds the known set", () => expect(writes.length).toBeGreaterThanOrEqual(12));
  it.each(writes)("%s", (f) => {
    const s = readFileSync(f, "utf8");
    if (ALLOWED_WITHOUT_CHECK[f]) return;
    expect(s, `${f} writes in the active workspace without requireExplicitWorkspace/guardShownWorkspace`).toMatch(/requireExplicitWorkspace|guardShownWorkspace/);
  });
});
