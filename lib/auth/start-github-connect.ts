"use client";

import { createClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/auth/safe-next-path";

export async function startGitHubConnect(nextPath?: string | null) {
  const safeNext = safeNextPath(nextPath, "/onboarding");

  document.cookie = `sequrai_auth_next=${encodeURIComponent(safeNext)}; path=/; max-age=600; SameSite=Lax`;

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      scopes: "read:user user:email",
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (error) throw error;
}
