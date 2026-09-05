"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrganizationByUser } from "@/services/organizations.service";
import type { ProjectInsert, ProjectUpdate } from "@/types/database";
import { projectSchema, projectUpdateSchema } from "@/features/projects/schemas/project.schema";
import { normalizeStoredGitHubRepository } from "@/lib/github/repository-reference";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

// ─── Project Server Actions ───────────────────────────────────────────────────
// These run on the server and can safely access Supabase with the service role.

export async function createProjectAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const raw = {
    name: formData.get("name") as string,
    description: formData.get("description") as string | null,
    github_repo: formData.get("github_repo") as string | null,
    production_url: formData.get("production_url") as string | null,
    framework: formData.get("framework") as string | null,
  };

  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { data: org } = await getOrganizationByUser(user.id);
  if (!org) return { error: { _root: ["No organization found"] } };

  const payload: ProjectInsert = {
    organization_id: org.id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    github_repo: normalizeStoredGitHubRepository(parsed.data.github_repo ?? null),
    production_url: parsed.data.production_url ?? null,
    framework: (parsed.data.framework as ProjectInsert["framework"]) ?? null,
  };

  const { data: project, error } = await supabase
    .from("projects")
    .insert(payload)
    .select()
    .single();

  if (error) return { error: { _root: [error.message] } };

  revalidatePath("/projects");
  redirect(projectVerdictHref(project.id));
}

export async function updateProjectAction(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const raw = {
    name: formData.get("name") as string,
    description: formData.get("description") as string | null,
    github_repo: formData.get("github_repo") as string | null,
    production_url: formData.get("production_url") as string | null,
    framework: formData.get("framework") as string | null,
  };

  const parsed = projectUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const payload: ProjectUpdate = {
    ...parsed.data,
    github_repo: normalizeStoredGitHubRepository(parsed.data.github_repo ?? null),
    updated_at: new Date().toISOString(),
  };

  // Phase 31.2 (Task 3 follow-up): this query has no explicit
  // organization_id check -- it relies entirely on the RLS policy
  // "Members can update their org projects" (001_initial_schema.sql:156)
  // to silently affect zero rows for a project outside the caller's
  // organization. That's a real, verified backstop, but without reading
  // back which row (if any) was actually touched, a cross-org attempt
  // looked identical to success: no `error`, redirect fires as normal.
  // Selecting the updated row's id makes that distinction explicit.
  const { data: updated, error } = await supabase
    .from("projects")
    .update(payload)
    .eq("id", projectId)
    .select("id");

  if (error) return { error: { _root: [error.message] } };
  if (!updated || updated.length === 0) {
    return { error: { _root: ["Project not found or you do not have access to update it."] } };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  redirect(projectVerdictHref(projectId));
}

export async function deleteProjectAction(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Same reasoning as updateProjectAction above -- RLS ("Owners and admins
  // can delete projects", 001_initial_schema.sql:166) genuinely blocks a
  // cross-org delete, but a silently-affected-zero-rows delete previously
  // looked identical to a real one from the caller's side.
  const { data: deleted, error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .select("id");

  if (error) return { error: error.message };
  if (!deleted || deleted.length === 0) {
    return { error: "Project not found or you do not have access to delete it." };
  }

  revalidatePath("/projects");
  redirect("/projects");
}
