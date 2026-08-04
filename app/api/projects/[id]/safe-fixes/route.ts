import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { generateSafeFix } from "@/server/safe-fix-engine/generate";
import { listSafeFixHistory } from "@/server/safe-fix-engine/history";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import {
  requestedAnalysisRunIdFromRequest,
  resolveAnalysisRunIdForIsolation,
} from "@/server/analysis-runs/resolve-analysis-run-id-for-isolation";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z.object({
  blockerId: z.string().uuid().optional(),
  priorityId: z.string().min(1).optional(),
  analysisRunId: z.string().uuid().optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const { id: projectId } = parsedParams.data;
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
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id: projectId } = parsedParams.data;
  const { blockerId, priorityId } = parsedBody.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const isolationEnabled = isFeatureEnabled("analysis_run_isolation", {
    organizationId: access.project.organization_id,
  });
  const { runId: analysisRunId, invalidRequest } = await resolveAnalysisRunIdForIsolation(admin, {
    projectId,
    organizationId: access.project.organization_id,
    requestedRunId: requestedAnalysisRunIdFromRequest(request, parsedBody.data.analysisRunId),
    isolationEnabled,
  });
  if (invalidRequest) {
    return NextResponse.json({ error: "Invalid analysis run" }, { status: 400 });
  }

  const result = await generateSafeFix(admin, {
    organizationId: access.project.organization_id,
    projectId,
    projectName: access.project.name ?? "Project",
    blockerId,
    priorityId,
    analysisRunId: analysisRunId ?? undefined,
    actor: access.userId,
  });

  return NextResponse.json({ projectId, result });
}
