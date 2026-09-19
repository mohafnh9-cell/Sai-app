"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";
import { isGoogleAuthEnabled } from "@/lib/auth/google-auth-enabled";

/**
 * The one real OAuth trigger for both login and signup -- Supabase treats
 * "sign in" and "sign up" identically at the OAuth layer (the provider
 * consent screen creates the account on first use), so there is exactly one
 * code path here, not two. Google and GitHub share it: same
 * signInWithOAuth() call, same /auth/callback, same session, same
 * redirectTo cookie. Never add a second auth system or a parallel session
 * here -- this only ever calls the existing Supabase Auth client.
 */
export function OAuthProviderButtons({
  redirectTarget,
  disabled = false,
  onLoadingChange,
}: {
  redirectTarget: string;
  disabled?: boolean;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const { t } = useI18n("auth");
  const [oauthLoading, setOauthLoading] = useState<"github" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOAuthLogin = async (provider: "github" | "google") => {
    setOauthLoading(provider);
    onLoadingChange?.(true);
    setError(null);
    try {
      document.cookie = `sequrai_auth_next=${encodeURIComponent(redirectTarget)}; path=/; max-age=600; SameSite=Lax`;
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          ...(provider === "github" ? { scopes: "read:user user:email" } : {}),
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setOauthLoading(null);
        onLoadingChange?.(false);
      }
      // On success Supabase navigates the browser away immediately -- no
      // "connected" state to show here; the /auth/callback route (existing,
      // shared with GitHub) is what actually establishes the session.
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : provider === "github"
            ? t("githubConnectFailed")
            : t("googleConnectFailed")
      );
      setOauthLoading(null);
      onLoadingChange?.(false);
    }
  };

  const isBusy = disabled || oauthLoading !== null;

  return (
    <div className="space-y-2.5">
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {isGoogleAuthEnabled() ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void handleOAuthLogin("google")}
          disabled={isBusy}
        >
          {oauthLoading === "google" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.11A12 12 0 0 0 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.61H1.26A12 12 0 0 0 0 12c0 1.94.46 3.77 1.26 5.39l4.01-3.11Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.61l4.01 3.11C6.22 6.86 8.87 4.75 12 4.75Z"
              />
            </svg>
          )}
          {oauthLoading === "google" ? t("redirectingGoogle") : t("continueGoogle")}
        </Button>
      ) : null}

      <Button
        variant="outline"
        className="w-full"
        onClick={() => void handleOAuthLogin("github")}
        disabled={isBusy}
      >
        {oauthLoading === "github" ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
        )}
        {oauthLoading === "github" ? t("redirectingGitHub") : t("continueGitHub")}
      </Button>
    </div>
  );
}
