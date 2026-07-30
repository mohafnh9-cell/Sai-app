import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import {
  createAttackAuthorization,
  listAttackAuthorizationsForProject,
} from "@/server/ai-red-team/authorization/store";
import { normalizeOrigin } from "@/server/ai-red-team/authorization/types";
import { isAttackAuthorizationAllowedForStagingApi } from "@/server/attack-simulation/integration/resolve-runtime-mode";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const createBodySchema = z.object({
  targetOrigin: z.string().url(),
  environmentType: z.enum(["local", "preview", "staging"]),
  authorizationMethod: z.string().min(1).max(64).default("manual_staging_approval"),
  approvedScope: z.record(z.unknown()).optional(),
  expiresInHours: z.number().int().min(1).max(168).default(24),
  maxRequestBudget: z.number().int().min(1).max(500).default(50),
  maxDurationSeconds: z.number().int().min(30).max(3600).default(900),
  pathExclusions: z.array(z.string()).optional(),
  redirectAllowlist: z.array(z.string().url()).optional(),
  commitSha: z.string().min(7).max(64).nullable().optional(),
});

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

  const { id: projectId } = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  if (!isFeatureEnabled("attack_simulation", { organizationId: access.project.organization_id })) {
    return NextResponse.json({ error: "Attack Simulation is not enabled" }, { status: 404 });
  }

  const admin = createAdminClient();
  const authorizations = await listAttackAuthorizationsForProject(admin, {
    organizationId: access.project.organization_id,
    projectId,
    limit: 20,
  });

  return NextResponse.json({
    authorizations: authorizations.map((authorization) => ({
      id: authorization.id,
      targetOrigin: authorization.targetOrigin,
      environmentType: authorization.environmentType,
      status: authorization.status,
      expiresAt: authorization.expiresAt,
      maxRequestBudget: authorization.maxRequestBudget,
      maxDurationSeconds: authorization.maxDurationSeconds,
    })),
  });
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

  const body = createBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!isAttackAuthorizationAllowedForStagingApi(body.data.environmentType)) {
    return NextResponse.json(
      { error: "Only staging, preview, or local authorizations can be created via this API" },
      { status: 400 }
    );
  }

  const { id: projectId } = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  if (!isFeatureEnabled("attack_simulation", { organizationId: access.project.organization_id })) {
    return NextResponse.json({ error: "Attack Simulation is not enabled" }, { status: 404 });
  }

  const now = Date.now();
  const approvedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + body.data.expiresInHours * 60 * 60 * 1000).toISOString();

  let targetOrigin: string;
  try {
    targetOrigin = normalizeOrigin(body.data.targetOrigin);
  } catch {
    return NextResponse.json({ error: "Invalid target origin" }, { status: 400 });
  }

  const admin = createAdminClient();
  const authorization = await createAttackAuthorization(admin, {
    organizationId: access.project.organization_id,
    projectId,
    targetOrigin,
    environmentType: body.data.environmentType,
    status: "approved",
    authorizationMethod: body.data.authorizationMethod,
    approvedScope: body.data.approvedScope ?? { scope: "attack_simulation_staging" },
    createdBy: access.userId,
    approvedAt,
    expiresAt,
    testCredentialsRef: null,
    pathExclusions: body.data.pathExclusions ?? [],
    redirectAllowlist: body.data.redirectAllowlist ?? [],
    maxRequestBudget: body.data.maxRequestBudget,
    maxDurationSeconds: body.data.maxDurationSeconds,
    commitSha: body.data.commitSha ?? null,
  });

  return NextResponse.json(
    {
      authorization: {
        id: authorization.id,
        targetOrigin: authorization.targetOrigin,
        environmentType: authorization.environmentType,
        status: authorization.status,
        expiresAt: authorization.expiresAt,
      },
    },
    { status: 201 }
  );
}
