"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { withAnalysisRunQuery } from "@/features/analysis-runs/lib/build-run-query";

/**
 * Canonical project navigation — Production Verdict, Security Test (conditional), History.
 */
export function ProjectWorkflowNav({
  projectId,
  analysisRunId,
  showSecurityTest = false,
}: {
  projectId: string;
  analysisRunId?: string | null;
  showSecurityTest?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n("missionControl");
  const base = `/projects/${projectId}`;
  const verdictHref = `${base}/mission-control`;
  const securityTestHref = `${base}/attack-center`;
  const historyHref = `${base}/journey`;

  const tabs = [
    {
      href: withAnalysisRunQuery(verdictHref, analysisRunId),
      label: t("subNav.productionVerdict"),
      active:
        pathname.startsWith(verdictHref) &&
        !pathname.startsWith(securityTestHref) &&
        !pathname.startsWith(historyHref),
    },
    ...(showSecurityTest
      ? [
          {
            href: withAnalysisRunQuery(securityTestHref, analysisRunId),
            label: t("subNav.securityTest"),
            active: pathname.startsWith(securityTestHref),
          },
        ]
      : []),
    {
      href: withAnalysisRunQuery(historyHref, analysisRunId),
      label: t("subNav.history"),
      active: pathname.startsWith(historyHref),
    },
  ];

  return (
    <nav aria-label={t("subNav.ariaLabel")} className="flex flex-wrap gap-2 mb-8">
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
