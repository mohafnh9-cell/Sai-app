"use client";

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
        "flex h-full w-[260px] shrink-0 flex-col border-r border-border/50 bg-card/90 glass-surface",
        className
      )}
    >
      <div className="relative flex items-center">
        <WorkspaceSwitcher
          key={activeWorkspaceId ?? "none"}
          initialWorkspaces={workspaces}
          initialActiveWorkspaceId={activeWorkspaceId}
          fallbackName={orgName ?? "SequrAI"}
          onNavigate={onNavigate}
          headerAction={headerAction}
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
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

      <div className="border-t border-border/50 p-3 space-y-2">
        <LanguageSelector variant="compact" className="w-full justify-start" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm hover:bg-accent/40 transition-all duration-200">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
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
        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all duration-200",
        active
          ? "bg-accent/60 text-foreground font-medium shadow-sm"
          : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}
