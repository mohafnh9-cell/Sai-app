import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createWorkspaceForUser } from "@/server/workspaces/mutations";
import {
  listAccessibleWorkspaces,
  readProfileWorkspacePreference,
  resolveActiveWorkspaceId,
} from "@/server/workspaces/service";
import { readActiveWorkspaceCookie } from "@/server/workspaces/active-workspace-cookie";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const [workspaces, profilePreferenceId, cookieId] = await Promise.all([
    listAccessibleWorkspaces(auth.supabase, auth.user.id),
    readProfileWorkspacePreference(auth.supabase, auth.user.id),
    readActiveWorkspaceCookie(),
  ]);

  const activeWorkspaceId = await resolveActiveWorkspaceId(auth.supabase, auth.user.id, {
    profilePreferenceId,
    cookieId,
  });

  return NextResponse.json({ workspaces, activeWorkspaceId });
}

export async function POST(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "validation" },
      { status: 422 }
    );
  }

  const result = await createWorkspaceForUser(auth.supabase, auth.user.id, parsed.data.name);
  if (!result.ok) {
    const status = result.code === "validation" ? 422 : 500;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  return NextResponse.json({ workspaceId: result.workspaceId }, { status: 201 });
}
