"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertWorkspaceMembership, resolveActiveWorkspaceIdForUser } from "@/server/workspaces/service";

export type AutopilotActionResult = { error: string | null; enabled?: boolean; code?: "workspace_context_mismatch" | "workspace_access_denied"; activeWorkspaceId?: string | null };

/**
 * `organizationId` is the workspace the settings page was rendered for (the one shown). It used to be "the user's first membership",
 * which for a person in several workspaces could be neither the one shown nor the active one. Now: it must be a workspace the user
 * belongs to AND still be the active one; otherwise nothing is written (never redirected to another workspace).
 */
export async function setVerdictAutopilotEnabledAction(organizationId: string, enabled: boolean): Promise<AutopilotActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!organizationId || !(await assertWorkspaceMembership(supabase, user.id, organizationId))) {
    return { error: "You do not have access to that workspace", code: "workspace_access_denied" };
  }
  const activeWorkspaceId = await resolveActiveWorkspaceIdForUser(supabase, user.id);
  if (activeWorkspaceId !== organizationId) {
    return {
      error: "The active workspace changed in another tab. Reload to continue; nothing was changed.",
      code: "workspace_context_mismatch",
      activeWorkspaceId,
    };
  }

  const { error } = await supabase
    .from("organizations")
    .update({
      verdict_autopilot_enabled: enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("id", organizationId);

  if (error) {
    if (error.message.includes("verdict_autopilot_enabled")) {
      return { error: "Production Review setting is not available yet. Apply migration 014." };
    }
    return { error: error.message };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/projects", "layout");
  return { error: null, enabled };
}
