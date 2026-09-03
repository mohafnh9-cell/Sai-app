"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { usePathname } from "next/navigation";
import { Menu, Search, X } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { AppBreadcrumbs } from "@/components/dashboard/AppBreadcrumbs";
import { CommandPalette, openCommandPalette } from "@/components/dashboard/CommandPalette";
import { Toaster } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { buildBreadcrumbsFromPathname } from "@/lib/navigation/breadcrumbs";
import type { WorkspacePresentation } from "@/lib/workspaces/presentation";
import { useI18n } from "@/lib/i18n/client";

type DashboardUser = {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
};

export function DashboardShell({
  user,
  orgName,
  workspaces,
  activeWorkspaceId,
  bypass,
  isAdmin,
  billingEnabled,
  children,
}: {
  user: DashboardUser;
  orgName?: string;
  workspaces?: WorkspacePresentation[];
  activeWorkspaceId?: string | null;
  bypass?: boolean;
  isAdmin?: boolean;
  billingEnabled?: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useI18n("dashboard");
  const { t: tn } = useI18n("navigation");
  const pathname = usePathname();
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
    <div className="flex h-app max-h-app overflow-hidden app-shell-bg">
      <CommandPalette />

      <div className="flex md:hidden fixed top-0 left-0 right-0 z-40 min-h-14 items-center gap-2 border-b border-border/50 bg-background px-3 safe-top">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => setMobileOpen(true)}
          aria-label={t("openMenu")}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <AppBreadcrumbs items={breadcrumbs} className="flex-1 min-w-0" />
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => openCommandPalette()}
          aria-label={t("search")}
        >
          <Search className="h-5 w-5" />
        </Button>
      </div>

      <div className="hidden md:flex h-full shrink-0">
        <DashboardSidebar
          user={user}
          orgName={orgName}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          isAdmin={isAdmin}
          billingEnabled={billingEnabled}
        />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          showClose={false}
          className="w-[240px] p-0 md:hidden outline-none"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">{t("openMenu")}</DialogPrimitive.Title>
          <DashboardSidebar
            user={user}
            orgName={orgName}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            isAdmin={isAdmin}
            billingEnabled={billingEnabled}
            onNavigate={() => setMobileOpen(false)}
            headerAction={
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label={t("closeMenu")}>
                  <X className="h-5 w-5" />
                </Button>
              </DialogPrimitive.Close>
            }
          />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col min-h-0 min-w-0">
        <DashboardHeader />
        <main
          className={cn(
            "flex-1 min-h-0 overflow-y-auto overscroll-y-contain pt-mobile-header md:pt-0"
          )}
        >
          {bypass && (
            <div className="border-b border-warning/30 bg-warning/5 px-4 py-2 text-center text-xs text-warning">
              {t("authBypassBanner")}
            </div>
          )}
          {children}
        </main>
      </div>

      <Toaster />
    </div>
  );
}
