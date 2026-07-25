import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getScanRequestContext,
  ScanRequestError,
} from "@/server/security-scanner/request-context";
import { GitHubServiceError, parseGitHubRepository } from "@/lib/github/repository-service";
import { createAdminClient, mapDatabaseError } from "@/server/security-scanner/admin-client";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { scheduleScanRun } from "@/server/jobs/schedule-scan";
import { expireStaleActiveReviewsForRepository } from "@/server/review-recovery/stale-review";

export const runtime = "nodejs";
export const maxDuration = 300;

const paramsSchema = z.object({ repositoryId: z.string().uuid() });
const createScanSchema = z
  .object({
    scanType: z.literal("full").default("full"),
    branch: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
const historySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().datetime({ offset: true }).optional(),
});

function responseForError(error: unknown) {
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
    const { supabase, user, project } = await getScanRequestContext(
      repositoryId,
      true
    );
    if (!project.github_repo) {
      throw new ScanRequestError(
        422,
        "GITHUB_REPOSITORY_REQUIRED",
        "Project has no GitHub repository"
      );
    }
    parseGitHubRepository(project.github_repo);
    const admin = createAdminClient();
    const now = Date.now();
    await expireStaleActiveReviewsForRepository(admin, repositoryId);

    const rateWindow = new Date(now - 60 * 60 * 1000).toISOString();
    const { count: recentScanCount } = await admin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("repository_id", repositoryId)
      .eq("triggered_by_user_id", user.id)
      .gte("created_at", rateWindow);
    if ((recentScanCount ?? 0) >= 5) {
      throw new ScanRequestError(
        429,
        "SCAN_RATE_LIMITED",
        "Maximum of five scans per repository per hour reached"
      );
    }

    const { data: scan, error: insertError } = await supabase
      .from("scans")
      .insert({
        organization_id: project.organization_id,
        project_id: project.id,
        repository_id: project.id,
        triggered_by_user_id: user.id,
        trigger_type: "manual",
        review_type: "manual",
        scan_type: parsedBody.data.scanType,
        status: "queued",
        progress: 0,
        progress_message: "Scan queued",
        branch: parsedBody.data.branch ?? null,
      })
      .select("*")
      .single();

    if (insertError) {
      // The partial unique index is the concurrency authority; querying first
      // alone would race under simultaneous requests.
      if (insertError.code === "23505") {
        const { data: active } = await supabase
          .from("scans")
          .select("id, status, progress, progress_message, created_at")
          .eq("repository_id", repositoryId)
          .in("status", [
            "queued",
            "fetching_repository",
            "indexing",
            "scanning",
            "calculating_score",
          ])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return NextResponse.json(
          { error: "A scan is already in progress", code: "SCAN_IN_PROGRESS", scan: active },
          { status: 409 }
        );
      }
      throw mapDatabaseError(insertError, "Could not create scan");
    }

    const { error: stateError } = await admin.from("repository_scan_state").upsert(
      {
        repository_id: repositoryId,
        organization_id: project.organization_id,
        active_scan_id: scan.id,
      },
      { onConflict: "repository_id" }
    );
    if (stateError) {
      await admin
        .from("scans")
        .update({
          status: "failed",
          error_code: "STATE_INITIALIZATION_FAILED",
          error_message: "Could not initialize repository scan state",
          failed_at: new Date().toISOString(),
        })
        .eq("id", scan.id);
      throw mapDatabaseError(stateError, "Could not initialize scan state");
    }

    // Queue the scan asynchronously so the HTTP response returns immediately.
    await scheduleScanRun(
      admin,
      {
        scanJobId: "",
        scanId: scan.id,
        organizationId: project.organization_id,
        projectId: project.id,
        userId: user.id,
        branch: parsedBody.data.branch,
        scanType: parsedBody.data.scanType,
        jobType: "manual_scan",
      },
      {
        scheduler: (fn) => {
          void fn();
        },
      }
    );

    return NextResponse.json({ scan_id: scan.id, scan }, { status: 202 });
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
