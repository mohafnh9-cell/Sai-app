import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getScanRequestContext,
  ScanRequestError,
} from "@/server/security-scanner/request-context";
import { GitHubServiceError } from "@/lib/github/repository-service";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { ScanEnqueueError } from "@/server/jobs/scan-execution/enqueue-scan-run";
import {
  ScanJobInfrastructureError,
  SCAN_JOB_INFRASTRUCTURE_MISSING,
} from "@/server/jobs/scan-job-infrastructure";
import {
  ReviewCommitResolutionError,
} from "@/server/review-start/resolve-latest-review-commit";
import { INNGEST_NOT_CONFIGURED } from "@/lib/env/inngest-config";
import { startRepositoryManualScan } from "@/server/security-scanner/start-repository-manual-scan";
import { mapStartScanResultToHttpBody } from "@/server/analysis-runs/map-start-scan-result";

export const runtime = "nodejs";
export const maxDuration = 300;

const paramsSchema = z.object({ repositoryId: z.string().uuid() });
const createScanSchema = z
  .object({
    scanType: z.literal("full").default("full"),
    branch: z.string().trim().min(1).max(255).optional(),
    forceNew: z.boolean().optional(),
  })
  .strict();
const historySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().datetime({ offset: true }).optional(),
});

function responseForError(error: unknown) {
  if (error instanceof ReviewCommitResolutionError) {
    return NextResponse.json(
      {
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
        error: error.message,
        code: SCAN_JOB_INFRASTRUCTURE_MISSING,
        migrationRequired: error.migrationRequired,
        organizationId: error.details.organizationId,
        projectId: error.details.projectId,
        scanId: error.details.scanId,
        environment: error.details.environment,
      },
      { status: 503 }
    );
  }
  if (error instanceof ScanEnqueueError) {
    const userMessage =
      error.code === INNGEST_NOT_CONFIGURED
        ? "No se pudo iniciar el procesamiento de la revisión."
        : error.message;
    return NextResponse.json(
      {
        error: userMessage,
        code: error.code,
      },
      { status: 503 }
    );
  }
  if (error instanceof ScanRequestError || error instanceof GitHubServiceError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        needsReauth: error.code === "GITHUB_REAUTH_REQUIRED",
      },
      { status: error.status }
    );
  }
  console.error({
    component: "repository-scans-api",
    event: "request_failed",
    errorType: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  if (error instanceof Error && error.message) {
    return NextResponse.json(
      { error: error.message, code: "SCAN_REQUEST_FAILED" },
      { status: 500 }
    );
  }
  return NextResponse.json(
    { error: "The scan request could not be completed", code: "SCAN_REQUEST_FAILED" },
    { status: 500 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string }> }
) {
  try {
    const rateLimited = enforceRateLimit(request);
    if (rateLimited) return rateLimited;

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid repository id" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const parsedBody = createScanSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsedBody.error.flatten() },
        { status: 422 }
      );
    }

    const { repositoryId } = parsedParams.data;
    const { supabase, user, project } = await getScanRequestContext(repositoryId, true);
    const admin = createAdminClient();

    const result = await startRepositoryManualScan(
      { supabase, admin, user: { id: user.id, email: user.email }, project },
      {
        repositoryId,
        scanType: parsedBody.data.scanType,
        branch: parsedBody.data.branch,
        forceNew: parsedBody.data.forceNew,
      }
    );

    const mapped = mapStartScanResultToHttpBody(result);
    return NextResponse.json(mapped.body, { status: mapped.status });
  } catch (error) {
    return responseForError(error);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string }> }
) {
  try {
    const rateLimited = enforceRateLimit(request);
    if (rateLimited) return rateLimited;

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid repository id" }, { status: 400 });
    }
    const url = new URL(request.url);
    const parsedQuery = historySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsedQuery.error.flatten() },
        { status: 422 }
      );
    }

    const { supabase } = await getScanRequestContext(parsedParams.data.repositoryId);
    let query = supabase
      .from("scans")
      .select("*")
      .eq("repository_id", parsedParams.data.repositoryId)
      .order("created_at", { ascending: false })
      .limit(parsedQuery.data.limit + 1);
    if (parsedQuery.data.cursor) query = query.lt("created_at", parsedQuery.data.cursor);

    const { data, error } = await query;
    if (error) throw new Error(`Could not load scan history: ${error.message}`);
    const hasMore = data.length > parsedQuery.data.limit;
    const scans = data.slice(0, parsedQuery.data.limit);
    return NextResponse.json({
      scans,
      nextCursor: hasMore ? scans.at(-1)?.created_at ?? null : null,
    });
  } catch (error) {
    return responseForError(error);
  }
}
