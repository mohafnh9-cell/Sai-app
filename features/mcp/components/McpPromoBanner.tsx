"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

const DISMISS_KEY = "sequrai_mcp_promo_dismissed";

type McpPromoBannerProps = {
  className?: string;
  variant?: "default" | "compact";
  /** When true, dismissal is stored in localStorage and the banner stays hidden. */
  persistDismiss?: boolean;
};

export function McpPromoBanner({
  className,
  variant = "default",
  persistDismiss = true,
}: McpPromoBannerProps) {
  const { t } = useI18n("settings");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (persistDismiss && typeof window !== "undefined") {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/mcp/keys", { cache: "no-store" });
        const data = (await response.json()) as { keys?: unknown[] };
        if (cancelled) return;
        if ((data.keys?.length ?? 0) > 0) return;
        setVisible(true);
      } catch {
        if (!cancelled) setVisible(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [persistDismiss]);

  const dismiss = useCallback(() => {
    setVisible(false);
    if (persistDismiss && typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, "1");
    }
  }, [persistDismiss]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "relative rounded-2xl border border-primary/25 bg-primary/5 p-4",
        variant === "compact" ? "space-y-3" : "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
      role="status"
    >
      <div className="flex items-start gap-3 pr-6 sm:pr-0">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{t("mcpPromoTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("mcpPromoBody")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Button size="sm" asChild>
          <Link href="/onboarding?step=cursor">{t("mcpPromoCta")}</Link>
        </Button>
        {variant === "default" ? (
          <Button size="sm" variant="ghost" asChild>
            <Link href="/settings#mcp-setup">{t("mcpPromoSettings")}</Link>
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          {t("mcpPromoDismiss")}
        </Button>
      </div>

      <button
        type="button"
        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground sm:hidden"
        onClick={dismiss}
        aria-label={t("mcpPromoDismiss")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
