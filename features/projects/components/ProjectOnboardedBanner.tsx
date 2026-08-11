"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

export function ProjectOnboardedBanner({
  readyToShip,
}: {
  readyToShip: boolean;
}) {
  const { t } = useI18n("projects");
  const [dismissed, setDismissed] = useState(false);

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("onboarded");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  if (dismissed) return null;

  return (
    <div
      className="relative mb-6 flex flex-col gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <p className="text-sm text-foreground sm:max-w-xl">
        {readyToShip ? t("onboardedBannerReady") : t("onboardedBannerFix")}
      </p>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Button size="sm" asChild>
          <Link href="/onboarding?step=cursor">{t("onboardedConnectCursor")}</Link>
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          {t("onboardedDismiss")}
        </Button>
      </div>
      <button
        type="button"
        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground sm:hidden"
        onClick={dismiss}
        aria-label={t("onboardedDismiss")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
