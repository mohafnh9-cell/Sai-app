import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import {
  FullProductAuditError,
  runFullProductAudit,
} from "@/server/full-product-audit";

export const maxDuration = 300;

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  dynamicVerificationDecision: z.enum(["authorize", "static_only"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsedParams = paramsSchema.safeParse(await params);
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedParams.success || !parsedBody.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const projectId = parsedParams.data.id;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("name, github_repo, github_repository_id")
    .eq("id", projectId)
    .eq("organization_id", access.project.organization_id)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const result = await runFullProductAudit(admin, {
      organizationId: access.project.organization_id,
      projectId,
      projectName: (project.name as string | null) ?? access.project.name ?? "Project",
      repositoryFullName: (project.github_repo as string | null) ?? null,
      githubRepo: (project.github_repo as string | null) ?? null,
      githubRepositoryId: (project.github_repository_id as number | null) ?? null,
      waitForReviewMs: 50_000,
      waitForSecurityTestsMs: 50_000,
      dynamicVerificationDecision: parsedBody.data.dynamicVerificationDecision,
    });

    return NextResponse.json({
      phase: result.phase,
      verdictStatus: result.verdictStatus,
      score: result.score,
      timedOut: result.timedOut,
      dynamicTestsExecuted: result.engines.securityTesting.executionsRun > 0,
      authorizedApplication: result.dynamicVerification.authorizedTarget,
      nextAction: result.nextAction,
      attackCenterHref: `/projects/${projectId}/attack-center`,
    });
  } catch (error) {
    if (error instanceof FullProductAuditError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    throw error;
  }
}
