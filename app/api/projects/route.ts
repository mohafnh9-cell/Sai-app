import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { projectSchema } from "@/features/projects/schemas/project.schema";
import { normalizeStoredGitHubRepository } from "@/lib/github/repository-reference";
import { enforceRateLimit } from "@/server/http/rate-limit";

// ─── GET /api/projects ────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
    .eq("organization_id", membership.organization_id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(projects);
}

// ─── POST /api/projects ───────────────────────────────────────────────────────

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = projectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      organization_id: membership.organization_id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      github_repo: normalizeStoredGitHubRepository(parsed.data.github_repo ?? null),
      production_url: parsed.data.production_url ?? null,
      framework: parsed.data.framework ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(project, { status: 201 });
}
