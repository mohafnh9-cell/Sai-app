"use client";

import { useState } from "react";
import { Menu, Search, X } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { CommandPalette, openCommandPalette } from "@/components/dashboard/CommandPalette";
import { Toaster } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  children,
}: {
  user: DashboardUser;
  orgName?: string;
  workspaces?: WorkspacePresentation[];
  activeWorkspaceId?: string | null;
  bypass?: boolean;
  isAdmin?: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useI18n("dashboard");

  return (
    <div className="flex h-app max-h-app overflow-hidden app-cinematic-bg">
      <CommandPalette />

      <div className="flex md:hidden fixed top-0 left-0 right-0 z-40 min-h-14 items-center gap-2 border-b border-border/50 bg-background/90 glass-surface px-3 safe-top">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => setMobileOpen(true)}
          aria-label={t("openMenu")}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="truncate text-sm font-semibold flex-1 min-w-0 text-gradient">
          SequrAI
        </span>
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
        />
      </div>

      {mobileOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-50 bg-black/50 md:hidden"
            aria-label={t("closeMenu")}
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden shadow-xl">
            <DashboardSidebar
              user={user}
              orgName={orgName}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              isAdmin={isAdmin}
              onNavigate={() => setMobileOpen(false)}
              headerAction={
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileOpen(false)}
                  aria-label={t("closeMenu")}
                >
                  <X className="h-5 w-5" />
                </Button>
              }
            />
          </div>
        </>
      )}

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
