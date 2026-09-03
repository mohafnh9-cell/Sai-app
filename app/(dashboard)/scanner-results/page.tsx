import { redirect } from "next/navigation";
import Link from "next/link";
import { ScrollText, ChevronRight, FolderGit2, UploadCloud, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { getTranslator } from "@/lib/i18n/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { listScannerResultsForOrganization } from "@/server/analysis-runs/list-scanner-results";
import { formatDurationCompact } from "@/lib/format/duration";
import { formatRelativeLocalized } from "@/lib/i18n/format";
import { scanResultStatus, scanResultStatusClass } from "@/lib/design-system/scan-status";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator("scannerResults");
  return { title: t("title") };
}

export default async function ScannerResultsPage() {
  const auth = await getCachedServerAuthContext();
  if (!auth) redirect("/login");
  if (!auth.organizationId) redirect("/onboarding");

  const { t, locale } = await getTranslator("scannerResults");
  const { t: tc } = await getTranslator("common");

  const admin = createAdminClient();
  const results = await listScannerResultsForOrganization(admin, {
    organizationId: auth.organizationId,
  });

  const relativeLabels = {
    never: tc("never"),
    justNow: tc("justNow"),
    minutesAgo: tc("minutesAgo"),
    hoursAgo: tc("hoursAgo"),
    daysAgo: tc("daysAgo"),
  };

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-6xl px-4 sm:px-8 py-8 sm:py-12 space-y-8">
        <PageHeader title={t("title")} description={t("subtitle")} />

        {results.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={{ label: t("emptyCta"), href: "/integrations" }}
            className="py-16"
          />
        ) : (
          <div className="space-y-1">
            {results.map((result) => {
              const status = scanResultStatus(result.status);
              const durationLabel = formatDurationCompact(result.durationMs);
              const findingsLabel =
                result.findingsCount == null
                  ? null
                  : result.findingsCount === 0
                    ? t("findingsNone")
                    : (result.criticalCount ?? 0) + (result.highCount ?? 0) > 0
                      ? t("findingsSummaryWithBlockers", {
                          blockers: (result.criticalCount ?? 0) + (result.highCount ?? 0),
                          total: result.findingsCount,
                        })
                      : t("findingsSummaryTotalOnly", { total: result.findingsCount });

              return (
                <Link
                  key={result.scanId}
                  href={`/scanner-results/${result.scanId}`}
                  className="group flex items-stretch gap-0 rounded-xl border border-border/50 bg-transparent seq-transition hover:bg-surface-hover seq-focus-ring overflow-hidden"
                >
                  <div className="flex flex-1 items-center justify-between gap-4 px-4 py-4 min-w-0">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/40 mt-0.5">
                        <FolderGit2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold">{result.projectName}</p>
                          <Badge
                            variant="outline"
                            className={cn(
                              scanResultStatusClass(status),
                              "text-[10px] px-1.5 py-0 uppercase tracking-wide"
                            )}
                          >
                            {t(`status.${status}`)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground font-mono">
                          {result.source === "upload" || result.source === "local" ? (
                            <>
                              <span className="inline-flex items-center gap-1 not-italic">
                                {result.source === "local" ? (
                                  <HardDrive className="h-3 w-3" aria-hidden />
                                ) : (
                                  <UploadCloud className="h-3 w-3" aria-hidden />
                                )}
                                {result.source === "local" ? t("sourceLocal") : t("sourceUpload")}
                              </span>
                              <span aria-hidden>·</span>
                            </>
                          ) : null}
                          <span>{result.commitSha ? result.commitSha.slice(0, 7) : t("noCommit")}</span>
                          {result.branch ? (
                            <>
                              <span aria-hidden>·</span>
                              <span>{result.branch}</span>
                            </>
                          ) : null}
                        </div>
                        {findingsLabel ? (
                          <p className="text-xs text-muted-foreground">{findingsLabel}</p>
                        ) : null}
                        {status === "failed" && result.errorMessage ? (
                          <p className="text-xs text-danger line-clamp-1">{result.errorMessage}</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="hidden sm:flex flex-col items-end gap-1 shrink-0 text-right">
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {durationLabel ?? t("durationUnknown")}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatRelativeLocalized(locale, result.createdAt, relativeLabels)}
                      </p>
                    </div>

                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground self-center group-hover:text-foreground seq-transition"
                      aria-hidden
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
