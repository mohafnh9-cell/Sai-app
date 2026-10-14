"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Check,
  ChevronDown,
  Loader2,
  LogOut,
  Plus,
  Settings2,
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
import { useDemoNavigation } from "@/features/demo/use-demo-navigation";
import { getWorkspaceDocumentationUrl } from "@/lib/workspaces/constants";
import {
  partitionWorkspaces,
  type WorkspacePresentation,
} from "@/lib/workspaces/presentation";
import { WorkspaceIcon } from "@/features/workspaces/components/WorkspaceIcon";
import { CreateWorkspaceDialog } from "@/features/workspaces/components/CreateWorkspaceDialog";

type WorkspacesResponse = {
  workspaces: WorkspacePresentation[];
  activeWorkspaceId: string | null;
};

function WorkspaceRow({
  workspace,
  active,
  disabled,
  onSelect,
}: {
  workspace: WorkspacePresentation;
  active?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || active}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
        "hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active && "bg-secondary/50",
        disabled && "opacity-60"
      )}
    >
      <WorkspaceIcon name={workspace.name} logoUrl={workspace.logoUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{workspace.name}</p>
        {workspace.plan && (
          <p className="truncate text-xs text-muted-foreground">{workspace.plan}</p>
        )}
      </div>
      {active && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}

// A reload would discard what the person is typing: leave a text field with content alone and try again on the next event.
function hasUnsavedTyping(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) return el.value.length > 0;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit"].includes(el.type) && el.value.length > 0;
  return el instanceof HTMLElement && el.isContentEditable && (el.textContent ?? "").length > 0;
}

// A reload per target workspace at most once a minute: if the layout and the API ever disagreed for a reason other than
// a switch in another tab, this must not turn into a reload loop.
function reloadedRecently(targetId: string): boolean {
  const key = `sequrai:ws-sync-reload:${targetId}`;
  try {
    const last = Number(window.sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 60_000) return true;
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // storage unavailable: allow the single reload, the event itself is rare
  }
  return false;
}

export function WorkspaceSwitcher({
  initialWorkspaces,
  initialActiveWorkspaceId,
  fallbackName = "SequrAI",
  variant = "sidebar",
  onNavigate,
  headerAction,
}: {
  initialWorkspaces?: WorkspacePresentation[];
  initialActiveWorkspaceId?: string | null;
  fallbackName?: string;
  variant?: "sidebar" | "mobile";
  onNavigate?: () => void;
  headerAction?: React.ReactNode;
}) {
  const { t } = useI18n("workspace");
  const { isDemo } = useDemoNavigation();
  const documentationUrl = getWorkspaceDocumentationUrl();

  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [fetchedWorkspaces, setFetchedWorkspaces] = useState<WorkspacesResponse | null>(null);
  const [loading, setLoading] = useState(!initialWorkspaces?.length);
  const [error, setError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  const { active, others } = useMemo(() => {
    const list = fetchedWorkspaces?.workspaces ?? initialWorkspaces ?? [];
    const activeId = fetchedWorkspaces?.activeWorkspaceId ?? initialActiveWorkspaceId ?? null;
    return partitionWorkspaces(list, activeId);
  }, [fetchedWorkspaces, initialWorkspaces, initialActiveWorkspaceId]);

  useEffect(() => {
    if (initialWorkspaces?.length || isDemo) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/workspaces", { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as WorkspacesResponse | null;
        if (cancelled) return;
        if (!response.ok || !data) {
          setError(t("loadFailed"));
          return;
        }
        setFetchedWorkspaces(data);
      } catch {
        if (!cancelled) setError(t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialWorkspaces, isDemo, t]);

  // The active workspace lives in a cookie shared by every tab. When another tab switches it, this tab keeps
  // showing (and has server-rendered data for) the old workspace. On return to the tab, compare with the server
  // and realign the whole page, as a switch in this tab does.
  const shownActiveId = active?.id ?? null;
  useEffect(() => {
    if (isDemo || !shownActiveId) return;
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/workspaces", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json().catch(() => null)) as WorkspacesResponse | null;
        if (cancelled || !data?.activeWorkspaceId) return;
        if (data.activeWorkspaceId === shownActiveId || hasUnsavedTyping()) return; // retried on the next focus/visibility event
        if (!reloadedRecently(data.activeWorkspaceId)) window.location.reload();
      } catch {
        // offline or transient: keep what is shown
      }
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [isDemo, shownActiveId]);

  const displayName = active?.name ?? fallbackName;

  const handleSwitch = async (workspaceId: string) => {
    if (isDemo || workspaceId === active?.id || isSwitching) return;
    setSwitchError(null);
    setIsSwitching(true);
    setOpen(false);
    onNavigate?.();

    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setSwitchError(data?.error ?? t("switchFailed"));
        setIsSwitching(false);
        return;
      }

      window.location.assign("/dashboard");
    } catch {
      setSwitchError(t("switchFailed"));
      setIsSwitching(false);
    }
  };

  const handleSignOut = async () => {
    setOpen(false);
    if (isDemo) {
      window.location.assign("/");
      return;
    }
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/");
  };

  const handleCreated = async () => {
    setCreateOpen(false);
    onNavigate?.();
    window.location.assign("/dashboard");
  };

  if (isDemo) {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 min-w-0",
          variant === "sidebar" ? "h-14 border-b border-border px-4" : "flex-1"
        )}
      >
        <WorkspaceIcon name={fallbackName} size="sm" />
        <span className="truncate text-sm font-semibold">{fallbackName}</span>
        {headerAction}
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "flex w-full items-center gap-1",
          variant === "sidebar" ? "h-14 border-b border-border px-2" : "min-w-0 flex-1"
        )}
      >
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={displayName}
              aria-busy={isSwitching}
              disabled={isSwitching}
              className={cn(
                "group flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                "hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                isSwitching && "opacity-80"
              )}
            >
              <WorkspaceIcon name={displayName} logoUrl={active?.logoUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{displayName}</span>
                {isSwitching && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {t("switching")}
                  </span>
                )}
              </div>
              {isSwitching ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                    open && "rotate-180"
                  )}
                />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className={cn(
              "w-[min(20rem,calc(100vw-2rem))] max-w-[20rem] border-border/70 bg-card/95 p-2 shadow-xl backdrop-blur-sm",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              "duration-150"
            )}
          >
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                …
              </div>
            ) : error ? (
              <p className="px-2 py-2 text-xs text-destructive">{error}</p>
            ) : !active ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">{t("noWorkspaces")}</p>
            ) : (
              <>
                <DropdownMenuLabel className="px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("currentWorkspace")}
                </DropdownMenuLabel>
                <WorkspaceRow workspace={active} active disabled={isSwitching} />

                {others.length > 0 && (
                  <>
                    <DropdownMenuSeparator className="my-2" />
                    <DropdownMenuLabel className="px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t("otherWorkspaces")}
                    </DropdownMenuLabel>
                    <div className="space-y-0.5">
                      {others.map((workspace) => (
                        <WorkspaceRow
                          key={workspace.id}
                          workspace={workspace}
                          disabled={isSwitching}
                          onSelect={() => void handleSwitch(workspace.id)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {switchError && (
              <p className="mt-2 px-2 text-xs text-destructive" role="alert">
                {switchError}
              </p>
            )}

            <DropdownMenuSeparator className="my-2" />

            <DropdownMenuItem
              className="gap-2 text-sm"
              disabled={isSwitching}
              onSelect={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              {t("createWorkspace")}
            </DropdownMenuItem>

            <DropdownMenuSeparator className="my-2" />

            <DropdownMenuItem asChild>
              <Link
                href="/settings/workspaces"
                className="gap-2 text-sm"
                onClick={() => setOpen(false)}
              >
                <Settings2 className="h-4 w-4" />
                {t("manageWorkspaces")}
              </Link>
            </DropdownMenuItem>

            {documentationUrl && (
              <DropdownMenuItem asChild>
                <a
                  href={documentationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gap-2 text-sm"
                  onClick={() => setOpen(false)}
                >
                  <BookOpen className="h-4 w-4" />
                  {t("documentation")}
                </a>
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator className="my-2" />

            <DropdownMenuItem
              className="gap-2 text-sm text-muted-foreground focus:text-foreground"
              onSelect={() => void handleSignOut()}
            >
              <LogOut className="h-4 w-4" />
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
    </>
  );
}
