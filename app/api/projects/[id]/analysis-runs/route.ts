import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { listAnalysisRunsForProject } from "@/server/analysis-runs/list-analysis-runs";
import { mapStartScanResultToAnalysisRunBody } from "@/server/analysis-runs/map-start-scan-result";
import { getScanRequestContext, ScanRequestError } from "@/server/security-scanner/request-context";
import { startRepositoryManualScan } from "@/server/security-scanner/start-repository-manual-scan";
import { GitHubServiceError } from "@/lib/github/repository-service";
import { ScanEnqueueError } from "@/server/jobs/scan-execution/enqueue-scan-run";
import {
  ScanJobInfrastructureError,
  SCAN_JOB_INFRASTRUCTURE_MISSING,
} from "@/server/jobs/scan-job-infrastructure";
import { ReviewCommitResolutionError } from "@/server/review-start/resolve-latest-review-commit";
import { INNGEST_NOT_CONFIGURED } from "@/lib/env/inngest-config";

const paramsSchema = z.object({ id: z.string().uuid() });

const postBodySchema = z.object({
  forceNew: z.boolean().optional(),
  branch: z.string().trim().min(1).max(255).optional(),
});

function responseForStartError(error: unknown) {
  if (error instanceof ReviewCommitResolutionError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        code: error.code,
        needsReauth: error.code === "GITHUB_TOKEN_UNAVAILABLE",
      },
      { status: error.code === "GITHUB_HEAD_UNAVAILABLE" ? 502 : 403 }
    );
  }
  if (error instanceof ScanJobInfrastructureError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        code: SCAN_JOB_INFRASTRUCTURE_MISSING,
      },
      { status: 503 }
    );
  }
  if (error instanceof ScanEnqueueError) {
    const userMessage =
      error.code === INNGEST_NOT_CONFIGURED
        ? "Could not start review processing."
        : error.message;
    return NextResponse.json({ ok: false, error: userMessage, code: error.code }, { status: 503 });
  }
  if (error instanceof ScanRequestError || error instanceof GitHubServiceError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        code: error.code,
        needsReauth: error.code === "GITHUB_REAUTH_REQUIRED",
      },
      { status: error.status }
    );
  }
  const message = error instanceof Error ? error.message : "Failed to start analysis run";
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

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

  if (
    !isFeatureEnabled("analysis_run_isolation", {
      organizationId: access.project.organization_id,
    })
  ) {
    return NextResponse.json({ error: "Analysis run isolation is not enabled" }, { status: 404 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 12, 1), 50) : 12;

  try {
    const admin = createAdminClient();
    const runs = await listAnalysisRunsForProject(admin, {
      projectId,
      organizationId: access.project.organization_id,
      limit,
    });
    return NextResponse.json({ ok: true, runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list analysis runs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

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

  if (
    !isFeatureEnabled("analysis_run_isolation", {
      organizationId: access.project.organization_id,
    })
  ) {
    return NextResponse.json({ error: "Analysis run isolation is not enabled" }, { status: 404 });
  }

  const parsedBody = postBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const { supabase: scanSupabase, user: scanUser, project } = await getScanRequestContext(
      projectId,
      true
    );
    const admin = createAdminClient();
    const result = await startRepositoryManualScan(
      { supabase: scanSupabase, admin, user: { id: scanUser.id, email: scanUser.email }, project },
      {
        repositoryId: projectId,
        scanType: "full",
        branch: parsedBody.data.branch,
        forceNew: parsedBody.data.forceNew ?? true,
      }
    );
    const mapped = mapStartScanResultToAnalysisRunBody(projectId, result);
    return NextResponse.json(mapped.body, { status: mapped.status });
  } catch (error) {
    return responseForStartError(error);
  }
}
