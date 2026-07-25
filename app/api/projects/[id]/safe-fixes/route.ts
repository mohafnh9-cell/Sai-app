import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { generateSafeFix } from "@/server/safe-fix-engine/generate";
import { listSafeFixHistory } from "@/server/safe-fix-engine/history";
import { requireProjectApiAccess } from "@/server/projects/project-access";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const history = await listSafeFixHistory(admin, projectId);
  return NextResponse.json({ projectId, safeFixes: history });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    blockerId?: string;
    priorityId?: string;
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const result = await generateSafeFix(admin, {
    organizationId: access.project.organization_id,
    projectId,
    projectName: access.project.name ?? "Project",
    blockerId: body.blockerId,
    priorityId: body.priorityId,
    actor: access.userId,
  });

  return NextResponse.json({ projectId, result });
}
