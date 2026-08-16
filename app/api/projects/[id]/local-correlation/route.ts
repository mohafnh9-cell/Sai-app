import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { buildLocalGitHubCorrelation } from "@/server/local-github-correlation/service";

const paramsSchema = z.object({ id: z.string().uuid() });

const bodySchema = z.object({
  commitSha: z.string().min(7).max(64).optional().nullable(),
  branch: z.string().max(256).optional().nullable(),
  findings: z
    .array(
      z.object({
        ruleId: z.string().min(1).max(200),
        filePath: z.string().min(1).max(1024),
        line: z.number().int().positive().optional().nullable(),
        severity: z.string().min(1).max(32),
        title: z.string().max(500).optional().nullable(),
        correlationKey: z.string().max(128).optional().nullable(),
        fingerprintMaterial: z.string().max(500).optional().nullable(),
      })
    )
    .max(200),
});

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid correlation payload" }, { status: 400 });
  }

  const projectId = parsedParams.data.id;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Correlation service unavailable" }, { status: 503 });
  }

  const correlation = await buildLocalGitHubCorrelation({
    admin,
    organizationId: access.project.organization_id,
    projectId,
    localCommitSha: body.data.commitSha ?? null,
    localBranch: body.data.branch ?? null,
    localFindings: body.data.findings,
  });

  return NextResponse.json({
    correlation,
    note: "GitHub persisted Production Verdict and scan findings are authoritative. Local correlation is evidence-based and may be unmatched when commit or identity evidence is insufficient.",
  });
}
