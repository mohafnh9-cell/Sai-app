"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function setVerdictAutopilotEnabledAction(enabled: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership?.organization_id) {
    return { error: "No organization found" };
  }

  const { error } = await supabase
    .from("organizations")
    .update({
      verdict_autopilot_enabled: enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("id", membership.organization_id);

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
