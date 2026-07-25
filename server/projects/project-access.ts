import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { canAccessRepository } from "@/server/security-scanner/authorization";

export type ProjectAccessRow = {
  id: string;
  organization_id: string;
  name?: string | null;
};

export async function getProjectAccessForUser(
  client: SupabaseClient,
  projectId: string,
  userId: string
): Promise<ProjectAccessRow | null> {
  const { data: project, error } = await client
    .from("projects")
    .select("id, organization_id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !project) return null;

  const { data: membership } = await client
    .from("organization_members")
    .select("user_id, organization_id")
    .eq("user_id", userId)
    .eq("organization_id", project.organization_id)
    .maybeSingle();

  if (
    !canAccessRepository({
      authenticatedUserId: userId,
      projectOrganizationId: project.organization_id,
      membership,
    })
  ) {
    return null;
  }

  return project as ProjectAccessRow;
}

type ProjectAccessOk = { ok: true; project: ProjectAccessRow; userId: string };
type ProjectAccessFail = { ok: false; response: NextResponse };

/** Membership + project gate for `/api/projects/[id]/*` before service-role calls. */
export async function requireProjectApiAccess(
  client: SupabaseClient,
  userId: string | undefined,
  projectId: string
): Promise<ProjectAccessOk | ProjectAccessFail> {
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const project = await getProjectAccessForUser(client, projectId, userId);
  if (!project) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  return { ok: true, project, userId };
}
