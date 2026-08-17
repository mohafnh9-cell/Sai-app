"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FolderGit2,
  History,
  LayoutDashboard,
  Puzzle,
  Search,
  Settings,
  Shield,
  Terminal,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { useDemoNavigation } from "@/features/demo/use-demo-navigation";

type CommandItem = {
  id: string;
  label: string;
  href: string;
  group: string;
  keywords?: string[];
  icon: React.ComponentType<{ className?: string }>;
};

type ProjectRow = { id: string; name: string };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const router = useRouter();
  const { t } = useI18n("navigation");
  const { t: td } = useI18n("dashboard");
  const { isDemo, href } = useDemoNavigation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("sequrai:command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("sequrai:command-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open || isDemo) return;
    let cancelled = false;
    void fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ProjectRow[]) => {
        if (!cancelled && Array.isArray(data)) {
          setProjects(data.map((p) => ({ id: p.id, name: p.name })));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, isDemo]);

  const navItems = useMemo<CommandItem[]>(
    () => [
      { id: "dashboard", label: t("dashboard"), href: href("/dashboard"), group: td("commandGroupNavigate"), icon: LayoutDashboard },
      { id: "projects", label: t("projects"), href: href("/projects"), group: td("commandGroupNavigate"), icon: FolderGit2 },
      { id: "integrations", label: t("integrations"), href: href("/integrations"), group: td("commandGroupNavigate"), icon: Puzzle },
      { id: "settings", label: t("settings"), href: href("/settings"), group: td("commandGroupNavigate"), icon: Settings },
      { id: "mcp", label: t("cursorMcp"), href: href("/onboarding?step=cursor"), group: td("commandGroupNavigate"), icon: Terminal },
    ],
    [href, t, td]
  );

  const projectItems = useMemo<CommandItem[]>(
    () =>
      projects.slice(0, 12).map((project) => ({
        id: `project-${project.id}`,
        label: project.name,
        href: href(`/projects/${project.id}/mission-control`),
        group: td("commandGroupProjects"),
        keywords: [project.name],
        icon: FolderGit2,
      })),
    [projects, href, td]
  );

  const recentItems = useMemo<CommandItem[]>(
    () =>
      projects.slice(0, 5).map((project) => ({
        id: `recent-${project.id}`,
        label: project.name,
        href: href(`/projects/${project.id}/mission-control`),
        group: td("commandGroupRecent"),
        keywords: [project.name, "recent"],
        icon: History,
      })),
    [projects, href, td]
  );

  const securityItems = useMemo<CommandItem[]>(
    () =>
      projects.slice(0, 5).map((project) => ({
        id: `security-${project.id}`,
        label: `${project.name} — ${t("technicalDetails")}`,
        href: href(`/projects/${project.id}/attack-center`),
        group: td("commandGroupSecurity"),
        keywords: [project.name, "security", "attack"],
        icon: Shield,
      })),
    [projects, href, t, td]
  );

  const allItems = useMemo(
    () => [...navItems, ...projectItems, ...recentItems, ...securityItems],
    [navItems, projectItems, recentItems, securityItems]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter((item) => {
      const haystack = [item.label, item.group, ...(item.keywords ?? [])].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [allItems, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of filtered) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const flatFiltered = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);

  const runCommand = useCallback(
    (item: CommandItem) => {
      setOpen(false);
      setQuery("");
      router.push(item.href);
    },
    [router]
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(flatFiltered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && flatFiltered[activeIndex]) {
      event.preventDefault();
      runCommand(flatFiltered[activeIndex]!);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setActiveIndex(0);
      }}
    >
        <DialogContent className="max-w-lg gap-0 p-0 overflow-hidden sm:rounded-xl" onKeyDown={onKeyDown}>
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="sr-only">{td("commandPaletteTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{td("commandPaletteDescription")}</DialogDescription>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                placeholder={td("commandSearchPlaceholder")}
                className="pl-9 border-0 bg-transparent shadow-none focus-visible:ring-0"
                autoFocus
                aria-label={td("commandSearchPlaceholder")}
              />
            </div>
          </DialogHeader>
          <div className="max-h-[min(360px,50vh)] overflow-y-auto border-t border-border/50 px-2 py-2">
            {flatFiltered.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground text-center">{td("commandNoResults")}</p>
            ) : (
              grouped.map(([group, items]) => (
                <div key={group} className="mb-2">
                  <p className="px-3 py-1.5 text-label-caps">{group}</p>
                  <ul role="listbox" aria-label={group}>
                    {items.map((item) => {
                      const index = flatFiltered.indexOf(item);
                      const active = index === activeIndex;
                      const Icon = item.icon;
                      return (
                        <li key={item.id} role="option" aria-selected={active}>
                          <button
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-left seq-transition seq-focus-ring",
                              active ? "bg-accent/60 text-foreground" : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                            )}
                            onClick={() => runCommand(item)}
                            onMouseEnter={() => setActiveIndex(index)}
                          >
                            <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                            <span className="truncate">{item.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </DialogContent>
    </Dialog>
  );
}

export function openCommandPalette() {
  window.dispatchEvent(new Event("sequrai:command-palette"));
}
