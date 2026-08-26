import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import {
  disconnectWorkspaceGitHubConnection,
  getWorkspaceGitHubConnectionView,
} from "@/server/github/workspace-connection-service";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

const disconnectSchema = z.object({}).strict();

async function resolveWorkspace(auth: NonNullable<Awaited<ReturnType<typeof getServerAuthContext>>>) {
  if (!auth.organizationId) {
    return {
      error: NextResponse.json(
        { error: "No active Workspace", code: "workspace_not_found" },
        { status: 404 }
      ),
    };
  }
  const allowed = await assertWorkspaceMembership(
    auth.supabase,
    auth.user.id,
    auth.organizationId
  );
  if (!allowed) {
    return {
      error: NextResponse.json(
        { error: "Workspace access denied", code: "workspace_access_denied" },
        { status: 403 }
      ),
    };
  }
  return { workspaceId: auth.organizationId };
}

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const resolved = await resolveWorkspace(auth);
  if ("error" in resolved) return resolved.error;

  const [connection, { data: organization }] = await Promise.all([
    getWorkspaceGitHubConnectionView(auth.supabase, resolved.workspaceId),
    auth.supabase
      .from("organizations")
      .select("name")
      .eq("id", resolved.workspaceId)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    connection,
    workspaceId: resolved.workspaceId,
    workspaceName: organization?.name ?? null,
  });
}

export async function DELETE(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const resolved = await resolveWorkspace(auth);
  if ("error" in resolved) return resolved.error;

  const body = await request.json().catch(() => ({}));
  const parsed = disconnectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", code: "validation" }, { status: 422 });
  }

  const { data: membership } = await auth.supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", resolved.workspaceId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (membership?.role !== "OWNER") {
    return NextResponse.json(
      { error: "Only Workspace owners can disconnect GitHub", code: "workspace_access_denied" },
      { status: 403 }
    );
  }

  try {
    await disconnectWorkspaceGitHubConnection(resolved.workspaceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not disconnect GitHub",
        code: "internal_error",
      },
      { status: 500 }
    );
  }
}
