import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { WORKSPACE_CONTEXT_HEADER } from "@/lib/workspaces/context-header";

export type ExplicitWorkspaceResult =
  | { ok: true; organizationId: string }
  | { ok: false; response: NextResponse };

/**
 * Writes that act on "the current workspace" must not trust the mutable active-workspace preference (a cookie shared by every tab) alone:
 * the client states the workspace it is SHOWING in a header, and the request proceeds only if that workspace is one the user belongs to
 * AND still is the active one. A mismatch is rejected (409) -- never silently redirected to the other workspace -- so a form left open in a
 * stale tab cannot write into a workspace the person is not looking at.
 *
 * `activeWorkspaceId` is the workspace the server resolved for this user (cookie, then profile, then primary). The returned
 * `organizationId` is the explicit, membership-checked context and is what the handler must use for the write.
 */
export async function requireExplicitWorkspace(
  request: Request,
  supabase: SupabaseClient,
  userId: string,
  activeWorkspaceId: string
): Promise<ExplicitWorkspaceResult> {
  const requested = request.headers.get(WORKSPACE_CONTEXT_HEADER)?.trim() ?? "";
  if (!requested) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "The workspace this request is for was not stated", code: "workspace_context_required" },
        { status: 400 }
      ),
    };
  }

  if (!(await assertWorkspaceMembership(supabase, userId, requested))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You do not have access to that workspace", code: "workspace_access_denied" },
        { status: 403 }
      ),
    };
  }

  if (requested.toLowerCase() !== activeWorkspaceId.toLowerCase()) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "The active workspace changed in another tab. Reload to continue; nothing was changed.",
          code: "workspace_context_mismatch",
          requestedWorkspaceId: requested,
          activeWorkspaceId,
        },
        { status: 409 }
      ),
    };
  }

  return { ok: true, organizationId: requested };
}

/** For handlers that use `getServerAuthContext()`: null means "proceed"; a response means "reject". Dev bypass and users with no workspace yet have no shown context to protect. */
export async function guardShownWorkspace(
  request: Request,
  auth: { supabase: SupabaseClient; user: { id: string }; organizationId: string | null; bypass: boolean }
): Promise<NextResponse | null> {
  if (auth.bypass || !auth.organizationId) return null;
  const result = await requireExplicitWorkspace(request, auth.supabase, auth.user.id, auth.organizationId);
  return result.ok ? null : result.response;
}
