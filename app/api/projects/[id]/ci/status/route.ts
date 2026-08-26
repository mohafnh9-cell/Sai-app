import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { requireCiProjectAccess } from "@/server/ci/ci-access";
import { getCiEnforcementStatus } from "@/server/ci/ci-enforcement-service";
import { InvalidCommitShaError, normalizeCommitSha } from "@/server/ci/validate-sha";
import { logCiEvent } from "@/server/ci/observability";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });

const querySchema = z.object({
  commitSha: z.string().trim().min(7).max(64),
  prNumber: z.coerce.number().int().positive().optional(),
  baseSha: z.string().trim().min(7).max(64).optional(),
  headSha: z.string().trim().min(7).max(64).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "Invalid project id" }, { status: 400 });
  }

  const accessResult = await requireCiProjectAccess(request, parsedParams.data.id);
  if (!accessResult.ok) return accessResult.response;

  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    commitSha: url.searchParams.get("commitSha"),
    prNumber: url.searchParams.get("prNumber") ?? undefined,
    baseSha: url.searchParams.get("baseSha") ?? undefined,
    headSha: url.searchParams.get("headSha") ?? undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json(
      { ok: false, error: "commitSha is required (7–64 hex characters)", code: "INVALID_QUERY" },
      { status: 400 }
    );
  }

  try {
    const status = await getCiEnforcementStatus(accessResult.access.admin, {
      projectId: accessResult.access.project.id,
      organizationId: accessResult.access.project.organization_id,
      commitSha: normalizeCommitSha(parsedQuery.data.commitSha),
      prNumber: parsedQuery.data.prNumber ?? null,
      baseSha: parsedQuery.data.baseSha ?? null,
      headSha: parsedQuery.data.headSha ?? null,
    });

    logCiEvent("ci_status_read", {
      organizationId: accessResult.access.project.organization_id,
      projectId: accessResult.access.project.id,
      commitSha: status.commitSha,
      prNumber: status.prNumber,
      scanId: status.scanId,
      authSource: accessResult.access.authSource,
      outcome: status.checkRun.conclusion,
      stale: status.stale,
    });

    return NextResponse.json({ ok: true, status });
  } catch (error) {
    if (error instanceof InvalidCommitShaError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: "INVALID_COMMIT_SHA" },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to read CI status";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
