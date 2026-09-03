"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { AppBreadcrumbs } from "./AppBreadcrumbs";
import { openCommandPalette } from "./CommandPalette";
import { buildBreadcrumbsFromPathname } from "@/lib/navigation/breadcrumbs";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

export function DashboardHeader() {
  const pathname = usePathname();
  const { t: td } = useI18n("dashboard");
  const { t: tn } = useI18n("navigation");
  const breadcrumbs = buildBreadcrumbsFromPathname(pathname ?? "/dashboard", {
    labels: {
      missionControl: tn("breadcrumbs.missionControl"),
      projects: tn("breadcrumbs.projects"),
      integrations: tn("breadcrumbs.integrations"),
      settings: tn("breadcrumbs.settings"),
      onboarding: tn("breadcrumbs.onboarding"),
      productionIntelligence: tn("breadcrumbs.productionIntelligence"),
      scannerResults: tn("breadcrumbs.scannerResults"),
      analyzeCode: tn("breadcrumbs.analyzeCode"),
      attackCenter: tn("breadcrumbs.attackCenter"),
      journey: tn("breadcrumbs.journey"),
      billing: tn("breadcrumbs.billing"),
      project: tn("breadcrumbs.project"),
    },
  });

  return (
    <header className="sticky top-0 z-30 hidden md:flex h-14 shrink-0 items-center gap-4 border-b border-border/50 bg-background px-6">
      <AppBreadcrumbs items={breadcrumbs} className="flex-1 min-w-0" />
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground shrink-0"
        onClick={() => openCommandPalette()}
        aria-label={td("commandPaletteOpen")}
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="hidden lg:inline">{td("commandSearchPlaceholder")}</span>
        <kbd className="hidden lg:inline-flex h-5 items-center rounded border border-border/60 px-1.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </Button>
    </header>
  );
}
