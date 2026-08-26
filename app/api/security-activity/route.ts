import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { z } from "zod";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  projectId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.organizationId) return NextResponse.json({ activity: [], notifications: [] });

  const supabase = auth.supabase;
  const membership = { organization_id: auth.organizationId };

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    projectId: url.searchParams.get("projectId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 422 });
  }

  let activityQuery = supabase
    .from("repository_activity")
    .select("id, project_id, scan_id, event_type, title, description, metadata, occurred_at")
    .eq("organization_id", membership.organization_id)
    .order("occurred_at", { ascending: false })
    .limit(parsed.data.limit);
  if (parsed.data.projectId) {
    activityQuery = activityQuery.eq("project_id", parsed.data.projectId);
  }

  const notificationsQuery = supabase
    .from("security_notifications")
    .select("id, project_id, notification_type, title, body, severity, read_at, created_at")
    .eq("organization_id", membership.organization_id)
    .order("created_at", { ascending: false })
    .limit(20);

  const [{ data: activity, error: activityError }, { data: notifications, error: notificationsError }] =
    await Promise.all([activityQuery, notificationsQuery]);

  if (activityError?.code === "42P01" || activityError?.code === "PGRST205") {
    return NextResponse.json({
      activity: [],
      notifications: [],
      schemaMissing: true,
    });
  }
  if (activityError) {
    return NextResponse.json({ error: activityError.message }, { status: 500 });
  }
  if (notificationsError && notificationsError.code !== "42P01") {
    return NextResponse.json({ error: notificationsError.message }, { status: 500 });
  }

  return NextResponse.json({
    activity: activity ?? [],
    notifications: notifications ?? [],
  });
}
