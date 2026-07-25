import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getSafeFixById } from "@/server/safe-fix-engine/history";
import {
  approveSafeFix,
  markSafeFixApplied,
  verifySafeFix,
} from "@/server/safe-fix-engine/verify";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; safeFixId: string }> }
) {
  const { id: projectId, safeFixId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const record = await getSafeFixById(admin, safeFixId);
  if (!record || record.projectId !== projectId) {
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
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const orgId = project.organization_id as string;
  const action = body.action ?? "verify";

  if (action === "approve") {
    await approveSafeFix(admin, { safeFixId, organizationId: orgId, projectId, actor: user.id });
    return NextResponse.json({ ok: true, state: "APPROVED" });
  }
  if (action === "applied") {
    await markSafeFixApplied(admin, { safeFixId, organizationId: orgId, projectId, actor: user.id });
    return NextResponse.json({ ok: true, state: "APPLIED" });
  }

  const verification = await verifySafeFix(admin, {
    safeFixId,
    organizationId: orgId,
    projectId,
    actor: user.id,
  });
  return NextResponse.json({ ok: true, verification });
}
