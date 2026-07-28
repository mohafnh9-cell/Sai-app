import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const projectId = parsed.data.id;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const state = await getProductionReviewState(admin, {
    organizationId: access.project.organization_id,
    projectId,
  });

  return NextResponse.json(
    { state },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
