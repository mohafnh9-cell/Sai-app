import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { getTranslator } from "@/lib/i18n/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getScannerResultDetail } from "@/server/analysis-runs/list-scanner-results";
import { formatDurationCompact } from "@/lib/format/duration";
import { formatLocalizedDate } from "@/lib/i18n/format";
import { scanResultStatus, scanResultStatusClass } from "@/lib/design-system/scan-status";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator("scannerResults");
  return { title: t("detailTitle") };
}

const TRACE_STAGE_ORDER = ["scan_started", "repository_fetched", "scan_completed", "verdict_persisted"] as const;

export default async function ScannerResultDetailPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  const auth = await getCachedServerAuthContext();
  if (!auth) redirect("/login");
  if (!auth.organizationId) redirect("/onboarding");

  const { t, locale } = await getTranslator("scannerResults");

  const admin = createAdminClient();
  // Server-side tenant scoping: getScannerResultDetail filters by
  // organizationId, so a scanId from another organization returns null here
  // (fail closed) rather than ever being fetched.
  const result = await getScannerResultDetail(admin, {
    organizationId: auth.organizationId,
    scanId,
  });

  if (!result) notFound();

  const status = scanResultStatus(result.status);
  const durationLabel = formatDurationCompact(result.durationMs);
  const scanTypeLabel =
    result.scanType === "incremental" ? t("scanTypeIncremental") : t("scanTypeFull");

  const completedStages = new Set(result.executionTrace.map((entry) => entry.stage));
  const traceByStage = new Map(result.executionTrace.map((entry) => [entry.stage, entry.at]));

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-8 py-8 sm:py-12 space-y-8">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/scanner-results">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> {t("backToResults")}
        </Link>
      </Button>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{result.projectName}</h1>
          <Badge
            variant="outline"
            className={cn(scanResultStatusClass(status), "text-[11px] uppercase tracking-wide")}
          >
            {t(`status.${status}`)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatLocalizedDate(locale, result.createdAt)}
        </p>
      </div>

      {status === "failed" && result.errorMessage ? (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <p className="font-medium">{t("detailError")}</p>
          <p className="mt-1">{result.errorMessage}</p>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <div>
          <dt className="text-label-caps">{t("detailBranch")}</dt>
          <dd className="mt-1 text-sm font-mono">{result.branch ?? t("durationUnknown")}</dd>
        </div>
        <div>
          <dt className="text-label-caps">{t("detailCommit")}</dt>
          <dd className="mt-1 text-sm font-mono">
            {result.commitSha ? result.commitSha.slice(0, 12) : t("noCommit")}
          </dd>
        </div>
        <div>
          <dt className="text-label-caps">{t("detailScanType")}</dt>
          <dd className="mt-1 text-sm">{scanTypeLabel}</dd>
        </div>
        <div>
          <dt className="text-label-caps">{t("detailSource")}</dt>
          <dd className="mt-1 text-sm">
            {result.source === "upload"
              ? t("sourceUpload")
              : result.source === "local"
                ? t("sourceLocal")
                : "GitHub"}
          </dd>
        </div>
        <div>
          <dt className="text-label-caps">{t("detailDuration")}</dt>
          <dd className="mt-1 text-sm tabular-nums">{durationLabel ?? t("durationUnknown")}</dd>
        </div>
        <div>
          <dt className="text-label-caps">{t("detailFilesAnalyzed")}</dt>
          <dd className="mt-1 text-sm tabular-nums">{result.filesAnalyzed ?? t("durationUnknown")}</dd>
        </div>
        <div>
          <dt className="text-label-caps">{t("detailFindings")}</dt>
          <dd className="mt-1 text-sm tabular-nums">
            {result.findingsCount ?? t("durationUnknown")}
          </dd>
        </div>
      </dl>

      <Separator />

      {result.executionTrace.length > 0 ? (
        <div className="space-y-3">
          <p className="text-label-caps">{t("detailExecution")}</p>
          <ul className="space-y-2">
            {TRACE_STAGE_ORDER.filter((stage) => completedStages.has(stage)).map((stage) => (
              <li key={stage} className="flex items-center gap-2.5 text-sm">
                <Check className="h-4 w-4 text-success shrink-0" aria-hidden />
                <span className="flex-1">{t(`execution.${stage}`)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatLocalizedDate(locale, traceByStage.get(stage)!)}
                </span>
              </li>
            ))}
            {status === "running" ? (
              <li className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                <span>{t(`status.running`)}</span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <Separator />

      <div>
        {result.hasVerdict ? (
          <Button asChild>
            <Link href={projectVerdictHref(result.projectId, { run: result.scanId })}>
              {t("viewProductionVerdict")}
            </Link>
          </Button>
        ) : status === "running" || status === "queued" ? (
          <Button asChild>
            <Link href={projectVerdictHref(result.projectId)}>{t("viewProductionVerdict")}</Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t("verdictPending")}</p>
        )}
      </div>
    </div>
  );
}
