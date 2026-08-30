"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OnboardingBackButton } from "./OnboardingBackButton";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startGitHubOAuth } from "@/lib/github/oauth-client";
import { useI18n } from "@/lib/i18n/client";

export function OnboardingGitHubStep({
  onConnected,
  onBack,
}: {
  onConnected: () => void;
  onBack?: () => void;
}) {
  const { t } = useI18n("onboarding");
  const { t: ti } = useI18n("integrations");
  const searchParams = useSearchParams();
  const [connecting, setConnecting] = useState(false);

  const githubError = useMemo(() => {
    const code = searchParams.get("githubError");
    if (!code) return null;
    const messages: Record<string, string> = {
      oauth_state_invalid: ti("oauthStateInvalid"),
      oauth_state_expired: ti("oauthStateExpired"),
      workspace_access_denied: ti("workspaceAccessDenied"),
      github_connection_failed: ti("connectFailed"),
    };
    return messages[code] ?? ti("connectFailed");
  }, [searchParams, ti]);

  useEffect(() => {
    const pending = localStorage.getItem("sequrai_github_connect");
    if (pending) {
      localStorage.removeItem("sequrai_github_connect");
      queueMicrotask(() => onConnected());
    }
  }, [onConnected]);

  const connect = async () => {
    setConnecting(true);
    localStorage.setItem("sequrai_github_connect", "1");
    try {
      const statusRes = await fetch("/api/github/app/status", { cache: "no-store" });
      const status = statusRes.ok
        ? ((await statusRes.json().catch(() => null)) as { configured?: boolean } | null)
        : null;

      if (status?.configured) {
        window.location.href = "/api/github/app/install?next=%2Fonboarding%3Fstep%3Dgithub";
        return;
      }

      await startGitHubOAuth("/onboarding?step=github");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {onBack && <OnboardingBackButton onClick={onBack} label={t("backToStart")} />}
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">{t("connectGitHubTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("connectGitHubBody")}</p>
      </div>

      <Button className="w-full gap-2" size="lg" onClick={() => void connect()} disabled={connecting}>
        <GitBranch className="h-4 w-4" aria-hidden />
        {connecting ? t("connectingGitHub") : t("connectGitHubCta")}
      </Button>

      {githubError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
          <p className="text-sm font-medium">{t("githubConnectFailedTitle")}</p>
          <p className="text-sm text-muted-foreground">{githubError}</p>
        </div>
      )}
    </div>
  );
}
