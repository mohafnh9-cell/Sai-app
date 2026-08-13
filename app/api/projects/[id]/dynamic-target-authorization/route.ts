import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { isFeatureEnabled } from "@/server/feature-flags";
import { enforceRateLimit } from "@/server/http/rate-limit";
import {
  approveDynamicTargetAuthorization,
  attemptAutomaticVerification,
  authorizeAndCheckDynamicTarget,
  getDynamicTargetAuthorizationStatus,
  initiateDynamicTargetVerification,
  verifyDynamicTargetOwnership,
} from "@/server/ai-red-team/authorization/dynamic-target-authorization-service";
import { normalizeHttpUrlInput } from "@/lib/url/normalize-http-url";
import { reapproveExpandedDynamicTargetScope } from "@/server/ai-red-team/authorization/dynamic-scope-expansion";
import { loadRequiredDynamicPathsForLatestScan } from "@/server/full-product-audit/load-required-dynamic-paths-for-project";

const paramsSchema = z.object({ id: z.string().uuid() });

const bodySchema = z.object({
  action: z.enum([
    "status",
    "check",
    "authorize_and_check",
    "initiate",
    "verify",
    "approve",
    "approve_scope_expansion",
  ]),
  targetOrigin: z
    .string()
    .optional()
    .transform((value) => (value ? normalizeHttpUrlInput(value) : value))
    .pipe(z.string().url().optional()),
  environmentType: z.enum(["preview", "staging"]).optional(),
  verificationMethod: z.enum(["http", "dns"]).optional(),
  allowedPaths: z.array(z.string()).optional(),
  expiresInHours: z.number().int().min(1).max(168).optional(),
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

  const projectId = parsed.data.id;
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
  const status = await getDynamicTargetAuthorizationStatus(admin, {
    organizationId: access.project.organization_id,
    projectId,
    targetOrigin: new URL(request.url).searchParams.get("targetOrigin") ?? undefined,
  });

  return NextResponse.json({ status });
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

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    const invalidUrl = body.error.issues.some((issue) => issue.path.includes("targetOrigin"));
    return NextResponse.json(
      { error: invalidUrl ? "Introduce una URL válida (ej. https://miapp.vercel.app)" : "Invalid request body" },
      { status: 400 }
    );
  }

  const projectId = parsed.data.id;
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
  const organizationId = access.project.organization_id;

  if (body.data.action === "status") {
    const status = await getDynamicTargetAuthorizationStatus(admin, {
      organizationId,
      projectId,
      targetOrigin: body.data.targetOrigin,
    });
    return NextResponse.json({ status });
  }

  if (!body.data.targetOrigin) {
    return NextResponse.json({ error: "targetOrigin is required" }, { status: 400 });
  }

  if (body.data.action === "initiate") {
    const result = await initiateDynamicTargetVerification(admin, {
      organizationId,
      projectId,
      targetOrigin: body.data.targetOrigin,
      verificationMethod: body.data.verificationMethod ?? "http",
      createdBy: access.userId,
    });
    return NextResponse.json(result, { status: 201 });
  }

  if (body.data.action === "check") {
    const result = await attemptAutomaticVerification(admin, {
      organizationId,
      projectId,
      targetOrigin: body.data.targetOrigin,
      createdBy: access.userId,
      environmentType: body.data.environmentType,
    });
    return NextResponse.json({
      verified: result.verified,
      authorized: result.verified && result.method === "existing_authorization",
      targetOrigin: result.targetOrigin,
      manualVerificationRequired:
        !result.verified && result.reason === "manual_verification_required",
      reason: result.verified ? null : result.reason,
    });
  }

  if (body.data.action === "authorize_and_check") {
    const result = await authorizeAndCheckDynamicTarget(admin, {
      organizationId,
      projectId,
      targetOrigin: body.data.targetOrigin,
      environmentType: body.data.environmentType ?? "staging",
      createdBy: access.userId,
    });
    return NextResponse.json({
      authorized: result.authorized,
      targetOrigin: result.targetOrigin,
      automatic: result.authorized,
      manualVerificationRequired:
        "manualVerificationRequired" in result
          ? result.manualVerificationRequired
          : false,
      reason: "reason" in result ? result.reason : null,
    });
  }

  if (body.data.action === "verify") {
    const result = await verifyDynamicTargetOwnership(admin, {
      organizationId,
      projectId,
      targetOrigin: body.data.targetOrigin,
    });
    if (!result.ok) {
      return NextResponse.json({ verified: false, reason: result.code }, { status: 422 });
    }
    return NextResponse.json({ verified: true, targetOrigin: result.targetOrigin });
  }

  if (body.data.action === "approve_scope_expansion") {
    const requiredPaths = await loadRequiredDynamicPathsForLatestScan(admin, {
      organizationId,
      projectId,
    });
    const expansion = await reapproveExpandedDynamicTargetScope(admin, {
      organizationId,
      projectId,
      targetOrigin: body.data.targetOrigin,
      requiredPaths,
      createdBy: access.userId,
    });
    if (!expansion.ok) {
      return NextResponse.json({ error: expansion.code, message: expansion.message }, { status: 403 });
    }
    return NextResponse.json({
      authorized: true,
      targetOrigin: expansion.authorization.targetOrigin,
      scopeUpdated: expansion.scopeChanged,
      message:
        "Autorización actualizada. SequrAI puede comprobar las rutas necesarias para verificar estas vulnerabilidades.",
    });
  }

  const approved = await approveDynamicTargetAuthorization(admin, {
    organizationId,
    projectId,
    targetOrigin: body.data.targetOrigin,
    environmentType: body.data.environmentType ?? "staging",
    allowedPaths: body.data.allowedPaths,
    expiresInHours: body.data.expiresInHours,
    createdBy: access.userId,
  });

  if (!approved.ok) {
    return NextResponse.json({ error: approved.code, message: approved.message }, { status: 403 });
  }

  return NextResponse.json(
    {
      authorization: {
        targetOrigin: approved.authorization.targetOrigin,
        environmentType: approved.authorization.environmentType,
        status: approved.authorization.status,
        expiresAt: approved.authorization.expiresAt,
        allowedPaths: approved.authorization.approvedScope.allowedPaths,
        maxRequestBudget: approved.authorization.maxRequestBudget,
        maxDurationSeconds: approved.authorization.maxDurationSeconds,
      },
    },
    { status: 201 }
  );
}
