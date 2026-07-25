"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrganizationByUser } from "@/services/organizations.service";
import type { ProjectInsert, ProjectUpdate } from "@/types/database";
import { projectSchema, projectUpdateSchema } from "@/features/projects/schemas/project.schema";
import { normalizeStoredGitHubRepository } from "@/lib/github/repository-reference";

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
  redirect(`/projects/${project.id}`);
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

  const { error } = await supabase
    .from("projects")
    .update(payload)
    .eq("id", projectId);

  if (error) return { error: { _root: [error.message] } };

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

export async function deleteProjectAction(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  redirect("/projects");
}
