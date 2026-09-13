"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FolderGit2,
  Settings,
  LogOut,
  Puzzle,
  Terminal,
  ShieldCheck,
  CreditCard,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
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

const WORKSPACE_GROUP = {
  groupLabelKey: "navGroup.workspace",
  items: [
    { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
    { href: "/projects", labelKey: "projects", icon: FolderGit2 },
    { href: "/scanner-results", labelKey: "scannerResults", icon: ScrollText },
  ],
} as const;

const CONNECT_GROUP = {
  groupLabelKey: "navGroup.connect",
  items: [
    { href: "/integrations", labelKey: "integrations", icon: Puzzle },
    { href: "/onboarding?step=cursor", labelKey: "cursorMcp", icon: Terminal },
  ],
} as const;

const SYSTEM_ITEMS = [{ href: "/settings", labelKey: "settings", icon: Settings }] as const;
const BILLING_ITEM = { href: "/billing", labelKey: "billing", icon: CreditCard } as const;

const SIDEBAR_COLLAPSED_STORAGE_KEY = "sequrai:sidebar-collapsed";

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
  isAdmin,
  billingEnabled,
  onNavigate,
  headerAction,
  className,
  collapsible = false,
}: {
  user: User;
  orgName?: string;
  workspaces?: WorkspacePresentation[];
  activeWorkspaceId?: string | null;
  isAdmin?: boolean;
  billingEnabled?: boolean;
  onNavigate?: () => void;
  headerAction?: React.ReactNode;
  className?: string;
  /** Desktop-only icon-rail collapse toggle. Leave off for the mobile sheet, which has its own show/hide. */
  collapsible?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n("navigation");
  const { t: tc } = useI18n("common");
  const { isDemo, href } = useDemoNavigation();

  // Starts expanded on every render (server and first client paint match, so
  // no hydration mismatch), then syncs the user's saved preference after
  // mount -- a one-frame flash on reload is the accepted tradeoff for a
  // client-only preference with no server-persisted equivalent.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!collapsible) return;
    // Deferred a tick so this reads as an async sync-from-external-storage
    // effect rather than a synchronous setState-in-effect (avoids a
    // cascading-render lint error) while still applying before the user
    // has a chance to interact with the sidebar.
    queueMicrotask(() => {
      try {
        setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true");
      } catch {
        // Private browsing / storage disabled -- stay expanded.
      }
    });
  }, [collapsible]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // Ignore -- preference just won't persist this session.
      }
      return next;
    });
  };

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

  const navGroups = [
    WORKSPACE_GROUP,
    CONNECT_GROUP,
    {
      groupLabelKey: "navGroup.system",
      items: billingEnabled ? [...SYSTEM_ITEMS, BILLING_ITEM] : SYSTEM_ITEMS,
    },
  ];

  const isCollapsed = collapsible && collapsed;

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border/40 bg-card seq-transition",
        isCollapsed ? "w-[68px]" : "w-[240px]",
        className
      )}
    >
      <div className={cn("flex items-center pt-4 pb-2", isCollapsed ? "justify-center px-2" : "justify-between px-4")}>
        {!isCollapsed && (
          <Link
            href={isDemo ? href("/dashboard") : "/dashboard"}
            className="inline-flex items-center gap-2 seq-focus-ring rounded-md"
            onClick={onNavigate}
          >
            <span className="text-sm font-semibold tracking-tight text-foreground">SequrAI</span>
          </Link>
        )}
        {collapsible && (
          <button
            type="button"
            onClick={toggleCollapsed}
            title={isCollapsed ? t("expandSidebar") : t("collapseSidebar")}
            aria-label={isCollapsed ? t("expandSidebar") : t("collapseSidebar")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground seq-transition seq-focus-ring"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} />
            )}
          </button>
        )}
      </div>

      {!isCollapsed && (
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
      )}

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4" aria-label="Primary">
        {navGroups.map((group) => (
          <div key={group.groupLabelKey} className="space-y-0.5">
            {!isCollapsed && (
              <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                {t(group.groupLabelKey)}
              </p>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                href={isDemo ? href(item.href) : item.href}
                label={t(item.labelKey)}
                icon={item.icon}
                active={isActive(item.href)}
                onNavigate={onNavigate}
                collapsed={isCollapsed}
              />
            ))}
          </div>
        ))}
        {isAdmin && !isDemo && (
          <NavLink
            href="/admin"
            label="Admin"
            icon={ShieldCheck}
            active={isActive("/admin")}
            onNavigate={onNavigate}
            collapsed={isCollapsed}
          />
        )}
      </nav>

      <div className="border-t border-border/40 p-2 space-y-1">
        {!isCollapsed && <LanguageSelector variant="compact" className="w-full justify-start" />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title={isCollapsed ? displayName : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg py-2 text-sm hover:bg-surface-hover seq-transition seq-focus-ring",
                isCollapsed ? "justify-center px-0" : "px-2.5"
              )}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {initials}
              </div>
              {!isCollapsed && (
                <div className="flex flex-1 flex-col items-start min-w-0">
                  <span className="truncate text-xs font-medium">{displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                </div>
              )}
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
  collapsed = false,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg py-2 text-sm seq-transition seq-focus-ring",
        collapsed ? "justify-center px-0" : "px-3",
        active
          ? "bg-accent/40 text-foreground font-medium"
          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
      )}
      aria-current={active ? "page" : undefined}
    >
      {active ? (
        <span
          className={cn(
            "absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary",
            collapsed ? "left-1" : "left-0"
          )}
          aria-hidden
        />
      ) : null}
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      {!collapsed && label}
    </Link>
  );
}
