import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getSafeFixById } from "@/server/safe-fix-engine/history";
import {
  approveSafeFix,
  markSafeFixApplied,
  verifySafeFix,
} from "@/server/safe-fix-engine/verify";
import { requireProjectApiAccess } from "@/server/projects/project-access";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; safeFixId: string }> }
) {
  const { id: projectId, safeFixId } = await context.params;
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
  const { id: projectId, safeFixId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { action?: string };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const orgId = access.project.organization_id;
  const action = body.action ?? "verify";

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

  const verification = await verifySafeFix(admin, {
    safeFixId,
    organizationId: orgId,
    projectId,
    actor: access.userId,
  });
  return NextResponse.json({ ok: true, verification });
}
