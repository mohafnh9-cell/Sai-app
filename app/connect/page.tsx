"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startGitHubConnect } from "@/lib/auth/start-github-connect";
import { I18nShell } from "@/components/shared/I18nShell";
import { useI18n } from "@/lib/i18n/client";

function ConnectRedirect() {
  const searchParams = useSearchParams();
  const { t } = useI18n("auth");
  const { t: tc } = useI18n("common");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    startGitHubConnect(searchParams.get("next")).catch((err) => {
      setError(err instanceof Error ? err.message : t("githubConnectFailed"));
    });
  }, [searchParams, t]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm text-center">
        <Link href="/" className="mb-8 inline-flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold">{tc("brand")}</span>
        </Link>

        {error ? (
          <div className="space-y-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login?redirectTo=/onboarding">{t("signIn")}</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <h1 className="text-xl font-semibold tracking-tight">{t("connectTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("connectSubtitle")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConnectPage() {
  return (
    <I18nShell>
      <Suspense
        fallback={
          <div className="flex min-h-dvh items-center justify-center bg-background">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        }
      >
        <ConnectRedirect />
      </Suspense>
    </I18nShell>
  );
}
