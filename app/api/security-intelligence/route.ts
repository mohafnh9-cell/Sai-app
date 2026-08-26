import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { enforceRateLimit } from "@/server/http/rate-limit";

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.organizationId) {
    return NextResponse.json({ error: "No organization" }, { status: 404 });
  }

  const supabase = auth.supabase;
  const orgId = auth.organizationId;

  const [priorities, recommendations, insights, timeline, patterns, reports, riskScores] =
    await Promise.all([
      supabase
        .from("ai_priorities")
        .select("*, scan:scans(id, project_id, completed_at)")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("ai_recommendations")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("security_insights")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("security_timeline")
        .select("*")
        .eq("organization_id", orgId)
        .order("occurred_at", { ascending: false })
        .limit(12),
      supabase
        .from("security_patterns")
        .select("*")
        .eq("organization_id", orgId)
        .order("occurrence_count", { ascending: false })
        .limit(8),
      supabase
        .from("ai_reports")
        .select("*, project:projects(id, name)")
        .eq("organization_id", orgId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("project_risk_scores")
        .select("*, project:projects(id, name)")
        .eq("organization_id", orgId)
        .order("calculated_at", { ascending: false })
        .limit(5),
    ]);

  const latestReport = reports.data?.[0] ?? null;

  return NextResponse.json({
    priorities: priorities.data ?? [],
    recommendations: recommendations.data ?? [],
    insights: insights.data ?? [],
    timeline: timeline.data ?? [],
    patterns: patterns.data ?? [],
    latestReport,
    riskScores: riskScores.data ?? [],
    coachTip: latestReport?.coach_tip ?? null,
  });
}
