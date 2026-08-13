"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startGitHubConnect } from "@/lib/auth/start-github-connect";
import { useI18n } from "@/lib/i18n/client";

export function GitHubReauthBanner({
  returnPath,
  message,
}: {
  returnPath: string;
  message?: string;
}) {
  const { t } = useI18n("integrations");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p>{message ?? t("githubReauthRequired")}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => void startGitHubConnect(returnPath)}
      >
        {t("githubReauthCta")}
      </Button>
    </div>
  );
}
