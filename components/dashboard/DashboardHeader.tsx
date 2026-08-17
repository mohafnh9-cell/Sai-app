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
  const breadcrumbs = buildBreadcrumbsFromPathname(pathname ?? "/dashboard");

  return (
    <header className="sticky top-0 z-30 hidden md:flex h-14 shrink-0 items-center gap-4 border-b border-border/50 bg-background/80 glass-surface px-6">
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
