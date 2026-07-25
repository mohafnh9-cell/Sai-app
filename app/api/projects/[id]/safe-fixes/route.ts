import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { generateSafeFix } from "@/server/safe-fix-engine/generate";
import { listSafeFixHistory } from "@/server/safe-fix-engine/history";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, organization_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const result = await generateSafeFix(admin, {
    organizationId: project.organization_id as string,
    projectId,
    projectName: project.name as string,
    blockerId: body.blockerId,
    priorityId: body.priorityId,
    actor: user.id,
  });

  return NextResponse.json({ projectId, result });
}
