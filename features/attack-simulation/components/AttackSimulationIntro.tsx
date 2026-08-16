"use client";

import { Swords } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

export function AttackSimulationIntro() {
  const { t } = useI18n("attackCenter");

  return (
    <header className="mb-8 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Swords className="h-5 w-5" aria-hidden />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{t("page.title")}</h1>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-2xl">
            {t("page.intro")}
          </p>
        </div>
      </div>
      <ol className="grid gap-2 sm:grid-cols-3 text-sm text-muted-foreground pt-2">
        <li className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
          <span className="font-medium text-foreground">{t("page.step1Title")}</span>
          <p className="mt-1 text-xs">{t("page.step1Body")}</p>
        </li>
        <li className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
          <span className="font-medium text-foreground">{t("page.step2Title")}</span>
          <p className="mt-1 text-xs">{t("page.step2Body")}</p>
        </li>
        <li className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
          <span className="font-medium text-foreground">{t("page.step3Title")}</span>
          <p className="mt-1 text-xs">{t("page.step3Body")}</p>
        </li>
      </ol>
    </header>
  );
}
