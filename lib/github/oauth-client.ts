"use client";

import { createClient } from "@/lib/supabase/client";

export async function startGitHubOAuth(nextPath: string) {
  const safeNext = nextPath.startsWith("/") ? nextPath : "/integrations";

  const prepareResponse = await fetch("/api/github/oauth/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!prepareResponse.ok) {
    const body = (await prepareResponse.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not prepare GitHub authorization for this Workspace");
  }

  document.cookie = `sequrai_auth_next=${encodeURIComponent(safeNext)}; path=/; max-age=900; SameSite=Lax`;

  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      scopes: "repo admin:repo_hook read:user user:email",
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (error) throw error;
  if (data.url) {
    window.location.assign(data.url);
  }
}
