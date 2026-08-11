"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspacePresentation } from "@/lib/workspaces/presentation";

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
  children,
}: {
  user: DashboardUser;
  orgName?: string;
  workspaces?: WorkspacePresentation[];
  activeWorkspaceId?: string | null;
  bypass?: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-app max-h-app overflow-hidden app-cinematic-bg">
      <div className="flex md:hidden fixed top-0 left-0 right-0 z-40 min-h-14 items-center gap-2 border-b border-border/60 bg-card/90 glass-surface px-3 safe-top">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="truncate text-sm font-semibold flex-1 min-w-0">
          {workspaces?.find((workspace) => workspace.id === activeWorkspaceId)?.name ??
            orgName ??
            "SequrAI"}
        </span>
      </div>

      <div className="hidden md:flex h-full shrink-0">
        <DashboardSidebar
          user={user}
          orgName={orgName}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
        />
      </div>

      {mobileOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-50 bg-black/50 md:hidden"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden shadow-xl">
            <DashboardSidebar
              user={user}
              orgName={orgName}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onNavigate={() => setMobileOpen(false)}
              headerAction={
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </Button>
              }
            />
          </div>
        </>
      )}

      <main className={cn("flex-1 min-h-0 overflow-y-auto overscroll-y-contain pt-mobile-header md:pt-0")}>
        {bypass && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-700 dark:text-amber-300">
            Auth bypass active (SEQURAI_BYPASS_AUTH) — remove before production
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
