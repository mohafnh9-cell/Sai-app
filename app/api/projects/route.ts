import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { resolveActiveWorkspaceIdForUser } from "@/server/workspaces/service";

// ─── GET /api/projects ────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const organizationId = await resolveActiveWorkspaceIdForUser(supabase, user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(projects);
}

// Phase 31.2: the POST handler that used to live here has been removed.
// It was a second, single-repo-only way to attach a `github_repo` string to
// a new project, entirely bypassing the canonical connect flow's
// protections (POST /api/github/connect: cross-org duplicate detection,
// installation-repo-ownership verification, github_repository_id/
// github_auth_mode population). An audit confirmed zero callers anywhere in
// this codebase or its documented API surface (only GET is used, by
// CommandPalette.tsx) -- removed rather than hardened, since there was
// nothing to migrate. Use POST /api/github/connect to connect a repository.
