import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getSafeFixById } from "@/server/safe-fix-engine/history";
import {
  approveSafeFix,
  markSafeFixApplied,
  verifySafeFix,
} from "@/server/safe-fix-engine/verify";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import {
  requestedAnalysisRunIdFromRequest,
  resolveAnalysisRunIdForIsolation,
} from "@/server/analysis-runs/resolve-analysis-run-id-for-isolation";

const paramsSchema = z.object({
  id: z.string().uuid(),
  safeFixId: z.string().uuid(),
});

const bodySchema = z.object({
  action: z.enum(["approve", "applied", "verify"]).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; safeFixId: string }> }
) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid project or safe fix id" }, { status: 400 });
  }

  const { id: projectId, safeFixId } = parsedParams.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const record = await getSafeFixById(admin, safeFixId);
  if (!record || record.projectId !== projectId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (record.organizationId !== access.project.organization_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ safeFix: record });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; safeFixId: string }> }
) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid project or safe fix id" }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id: projectId, safeFixId } = parsedParams.data;
  const action = parsedBody.data.action ?? "verify";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const orgId = access.project.organization_id;

  const existing = await getSafeFixById(admin, safeFixId);
  if (!existing || existing.projectId !== projectId || existing.organizationId !== orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action === "approve") {
    await approveSafeFix(admin, { safeFixId, organizationId: orgId, projectId, actor: access.userId });
    return NextResponse.json({ ok: true, state: "APPROVED" });
  }
  if (action === "applied") {
    await markSafeFixApplied(admin, { safeFixId, organizationId: orgId, projectId, actor: access.userId });
    return NextResponse.json({ ok: true, state: "APPLIED" });
  }

  const isolationEnabled = isFeatureEnabled("analysis_run_isolation", { organizationId: orgId });
  const { runId: analysisRunId } = await resolveAnalysisRunIdForIsolation(admin, {
    projectId,
    organizationId: orgId,
    requestedRunId: requestedAnalysisRunIdFromRequest(request),
    isolationEnabled,
  });

  const verification = await verifySafeFix(admin, {
    safeFixId,
    organizationId: orgId,
    projectId,
    analysisRunId,
    actor: access.userId,
  });
  return NextResponse.json({ ok: true, verification });
}
