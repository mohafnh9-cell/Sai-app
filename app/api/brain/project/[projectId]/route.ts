import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { buildProjectBrain } from "@/server/brain/build-project-brain";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

const paramsSchema = z.object({ projectId: z.string().uuid() });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const auth = await getServerAuthContext();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id, organization_id")
    .eq("id", parsed.data.projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (!auth.bypass) {
    const { data: membership } = await auth.supabase
      .from("organization_members")
      .select("organization_id")
      .eq("organization_id", project.organization_id)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const brain = await buildProjectBrain(auth.supabase, parsed.data.projectId);
  if (!brain) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  return NextResponse.json(
    { brain },
    {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    }
  );
}
