import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAuthBypassAllowed, isRunningOnVercel } from "@/lib/env/production-guard";
import {
  resolveActiveWorkspaceIdForUser,
} from "@/server/workspaces/service";

export function isAuthBypassEnabled(): boolean {
  // Redundant, independent of isAuthBypassAllowed()'s own guard — this
  // function fabricates an authenticated admin-capable session, so it must
  // never activate on a real deployment even if the shared guard has a bug.
  if (isRunningOnVercel()) return false;
  return isAuthBypassAllowed();
}

type BypassContext = {
  user: User;
  organizationId: string;
  orgName: string;
};

let cachedBypass: BypassContext | null = null;

export async function getDevBypassContext(): Promise<BypassContext | null> {
  if (!isAuthBypassEnabled()) return null;
  if (cachedBypass) return cachedBypass;

  try {
    const admin = createAdminClient();
    const { data: member } = await admin
      .from("organization_members")
      .select("user_id, organization_id, organization:organizations(name)")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!member?.user_id || !member.organization_id) return null;

    cachedBypass = {
      user: {
        id: member.user_id,
        email: "bypass@sequrai.dev",
        app_metadata: {},
        user_metadata: { full_name: "Dev Preview" },
        aud: "authenticated",
        created_at: new Date().toISOString(),
      } as User,
      organizationId: member.organization_id,
      orgName: (member.organization as { name?: string } | null)?.name ?? "SequrAI",
    };
    return cachedBypass;
  } catch {
    return null;
  }
}

export type ServerAuthContext = {
  user: User;
  supabase: SupabaseClient;
  organizationId: string | null;
  orgName: string | null;
  bypass: boolean;
};

export async function getServerAuthContext(): Promise<ServerAuthContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const organizationId = await resolveActiveWorkspaceIdForUser(supabase, user.id);
    let orgName: string | null = null;

    if (organizationId) {
      const { data: organization } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();
      orgName = organization?.name ?? null;
    }

    return {
      user,
      supabase,
      organizationId,
      orgName,
      bypass: false,
    };
  }

  const bypass = await getDevBypassContext();
  if (!bypass) return null;

  return {
    user: bypass.user,
    supabase: createAdminClient(),
    organizationId: bypass.organizationId,
    orgName: bypass.orgName,
    bypass: true,
  };
}
