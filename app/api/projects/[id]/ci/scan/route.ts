import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { requireCiProjectAccess } from "@/server/ci/ci-access";
import { ensureCiScan } from "@/server/ci/ci-enforcement-service";
import { InvalidCommitShaError, normalizeCommitSha } from "@/server/ci/validate-sha";

export const runtime = "nodejs";
export const maxDuration = 60;

const paramsSchema = z.object({ id: z.string().uuid() });

const bodySchema = z
  .object({
    commitSha: z.string().trim().min(7).max(64),
    prNumber: z.number().int().positive().optional(),
    baseSha: z.string().trim().min(7).max(64).optional(),
    headSha: z.string().trim().min(7).max(64).optional(),
    forceNew: z.boolean().optional(),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: "Invalid project id" }, { status: 400 });
  }

  const accessResult = await requireCiProjectAccess(request, parsedParams.data.id);
  if (!accessResult.ok) return accessResult.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { ok: false, error: "commitSha is required", code: "INVALID_BODY" },
      { status: 400 }
    );
  }

  try {
    const result = await ensureCiScan(accessResult.access, {
      commitSha: normalizeCommitSha(parsedBody.data.commitSha),
      prNumber: parsedBody.data.prNumber ?? null,
      baseSha: parsedBody.data.baseSha ?? null,
      headSha: parsedBody.data.headSha ?? null,
      forceNew: parsedBody.data.forceNew === true,
    });

    if (result.outcome === "failed") {
      const statusCode =
        result.code === "GITHUB_TOKEN_UNAVAILABLE" || result.code === "GITHUB_AUTH"
          ? 403
          : result.code === "GITHUB_NOT_FOUND" || result.code === "PR_SHA_MISMATCH"
            ? 400
            : result.code === "GITHUB_REPOSITORY_REQUIRED"
              ? 422
              : 503;
      return NextResponse.json(
        { ok: false, error: result.message, code: result.code, status: result.status ?? null },
        { status: statusCode }
      );
    }

    const httpStatus =
      result.outcome === "scheduled" || result.outcome === "awaiting_webhook" ? 202 : 200;

    return NextResponse.json(
      {
        ok: true,
        outcome: result.outcome,
        message: result.message,
        status: result.status,
      },
      { status: httpStatus }
    );
  } catch (error) {
    if (error instanceof InvalidCommitShaError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: "INVALID_COMMIT_SHA" },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to ensure CI scan";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
