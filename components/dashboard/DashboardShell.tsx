"use client";

import { useEffect, useState } from "react";
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
import { geistSans, geistMono } from "@/lib/fonts";
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

  // Phase 43 closure: Radix Dialog/DropdownMenu/Sheet render their content
  // through a Portal into document.body, a SIBLING of this component's own
  // `.app-shell` div -- so a class-scoped CSS custom property never reaches
  // them (confirmed live: a portaled menu resolved --color-primary to the
  // OLD root purple, not the app-shell teal). `<html>` is the nearest
  // shared ancestor of both, so mirror the scope there for the duration
  // this shell is mounted. See app/globals.css's `[data-app-shell]` rules.
  //
  // Also applies next/font's Geist variable classes to `<html>`: they were
  // declared in lib/fonts.ts but never actually attached anywhere, so
  // `var(--font-geist-sans)` was an unset custom property -- an invalid
  // var() reference makes the WHOLE font-family declaration invalid at
  // compute time, not just that one fallback slot, so it silently fell
  // through to the inherited root Inter instead (confirmed live via
  // getComputedStyle: the app shell was rendering in Inter, not Geist).
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-app-shell", "true");
    html.classList.add(geistSans.variable, geistMono.variable);
    return () => {
      html.removeAttribute("data-app-shell");
      html.classList.remove(geistSans.variable, geistMono.variable);
    };
  }, []);

  // UX audit finding (frontend-ui-ux, Jakob's Law -- anchor links are
  // expected to just work): navigating to a route with a hash (e.g. the
  // new "Connect" nav item -> /settings#mcp-setup) landed at the TOP of
  // the page, not scrolled to the target section. Confirmed live:
  // window.scrollY stayed 0 even ~800ms after load. Root cause is a
  // server-component page whose content streams in after the browser's
  // one-time native hash-scroll attempt already ran against an empty
  // shell. Retries scrollIntoView for ~1.5s to cover that streaming
  // window, then gives up -- this fixes hash-scrolling for every
  // authenticated route, not just the one that surfaced it.
  // No dependency array (runs after every render, not just on mount/
  // pathname-change): with `[pathname]`, this reliably failed to run on
  // the very first render of a fresh full page load (confirmed by adding
  // temporary console logging -- with the dependency array present, the
  // effect body never executed at all on initial mount; removing it fixed
  // that immediately). The effect body is a no-op within a microtask
  // whenever there's no hash, so running it on every render is cheap.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    let attempts = 0;
    const id = window.setInterval(() => {
      attempts += 1;
      const target = document.getElementById(hash);
      if (target) {
        target.scrollIntoView({ block: "start" });
        window.clearInterval(id);
      } else if (attempts >= 15) {
        window.clearInterval(id);
      }
    }, 100);
    return () => window.clearInterval(id);
  });
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
    <div className="app-shell flex h-app max-h-app overflow-hidden app-shell-bg">
      <CommandPalette />

      <div className="hidden md:block">
        <DashboardSidebar
          user={user}
          orgName={orgName}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          isAdmin={isAdmin}
          billingEnabled={billingEnabled}
          collapsible
        />
      </div>

      <div className="flex md:hidden fixed top-0 left-0 right-0 z-40 min-h-14 items-center gap-2 border-b border-border bg-background/80 backdrop-blur-md px-3 safe-top">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => setMobileOpen(true)}
          aria-label={t("openMenu")}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="text-sm font-semibold tracking-tight text-foreground">SequrAI</span>
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

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          showClose={false}
          className="w-[260px] p-0 md:hidden outline-none flex flex-col"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">{t("openMenu")}</DialogPrimitive.Title>
          <div className="flex justify-end px-2 pt-2">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t("closeMenu")}>
                <X className="h-5 w-5" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <DashboardSidebar
            user={user}
            orgName={orgName}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            isAdmin={isAdmin}
            billingEnabled={billingEnabled}
            onNavigate={() => setMobileOpen(false)}
            className="w-full border-r-0"
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
