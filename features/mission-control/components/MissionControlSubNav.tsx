"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function MissionControlSubNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const missionHref = `/projects/${projectId}/mission-control`;
  const attackHref = `/projects/${projectId}/attack-center`;

  const tabs = [
    {
      href: missionHref,
      label: "Overview",
      active: pathname.startsWith(missionHref) && !pathname.startsWith(attackHref),
    },
    {
      href: attackHref,
      label: "Security test",
      active: pathname.startsWith(attackHref),
    },
  ];

  return (
    <nav aria-label="Mission sections" className="flex flex-wrap gap-2 mb-8">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            tab.active
              ? "bg-accent/60 text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
          )}
          aria-current={tab.active ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
