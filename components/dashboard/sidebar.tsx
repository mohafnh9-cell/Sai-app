"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FolderGit2,
  Settings,
  LogOut,
  Puzzle,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";
import { LanguageSelector } from "@/components/shared/LanguageSelector";
import { useDemoNavigation } from "@/features/demo/use-demo-navigation";
import { WorkspaceSwitcher } from "@/features/workspaces/components/WorkspaceSwitcher";
import type { WorkspacePresentation } from "@/lib/workspaces/presentation";

const PRIMARY_NAV = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/projects", labelKey: "projects", icon: FolderGit2 },
  { href: "/integrations", labelKey: "integrations", icon: Puzzle },
  { href: "/onboarding?step=cursor", labelKey: "cursorMcp", icon: Terminal },
  { href: "/settings", labelKey: "settings", icon: Settings },
] as const;

type User = {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
};

export function DashboardSidebar({
  user,
  orgName,
  workspaces,
  activeWorkspaceId,
  onNavigate,
  headerAction,
  className,
}: {
  user: User;
  orgName?: string;
  workspaces?: WorkspacePresentation[];
  activeWorkspaceId?: string | null;
  onNavigate?: () => void;
  headerAction?: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n("navigation");
  const { t: tc } = useI18n("common");
  const { isDemo, href } = useDemoNavigation();

  const handleLogout = async () => {
    if (isDemo) {
      router.push("/");
      return;
    }
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const displayName =
    user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "User";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const isActive = (path: string) => {
    const target = isDemo ? href(path) : path;
    const targetPath = target.split("?")[0];
    if (path.startsWith("/onboarding")) {
      return pathname.startsWith("/onboarding") && target.includes("step=cursor");
    }
    return path === "/dashboard"
      ? pathname === targetPath
      : pathname.startsWith(targetPath);
  };

  return (
    <aside
      className={cn(
        "flex h-full w-[240px] shrink-0 flex-col border-r border-border/40 bg-card/80",
        className
      )}
    >
      <div className="px-4 pt-4 pb-2">
        <Link
          href={isDemo ? href("/dashboard") : "/dashboard"}
          className="inline-flex items-center gap-2 seq-focus-ring rounded-md"
          onClick={onNavigate}
        >
          <span className="text-sm font-semibold tracking-tight text-gradient">SequrAI</span>
        </Link>
      </div>

      <div className="relative flex items-center px-2">
        <WorkspaceSwitcher
          key={activeWorkspaceId ?? "none"}
          initialWorkspaces={workspaces}
          initialActiveWorkspaceId={activeWorkspaceId}
          fallbackName={orgName ?? "SequrAI"}
          onNavigate={onNavigate}
          headerAction={headerAction}
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5" aria-label="Primary">
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.href}
            href={isDemo ? href(item.href) : item.href}
            label={t(item.labelKey)}
            icon={item.icon}
            active={isActive(item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="border-t border-border/40 p-2 space-y-1">
        <LanguageSelector variant="compact" className="w-full justify-start" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-hover seq-transition seq-focus-ring">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {initials}
              </div>
              <div className="flex flex-1 flex-col items-start min-w-0">
                <span className="truncate text-xs font-medium">{displayName}</span>
                <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-xs">{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={isDemo ? href("/settings") : "/settings"} className="text-sm">
                {t("settings")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-sm text-destructive focus:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              {tc("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm seq-transition seq-focus-ring",
        active
          ? "bg-accent/40 text-foreground font-medium"
          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
      )}
      aria-current={active ? "page" : undefined}
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden />
      ) : null}
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      {label}
    </Link>
  );
}
