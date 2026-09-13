import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CollapsibleSection } from "@/components/shared/CollapsibleSection";
import { InfoTip } from "@/components/shared/InfoTip";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { RecommendedAction } from "@/components/sequrai/RecommendedAction";
import { ProductionReadinessScore } from "@/components/sequrai/ProductionReadinessScore";
import { TechnicalFindingsSection } from "@/features/production-verdict/components/TechnicalFindingsSection";
import { AiReasoningPanel } from "@/features/production-verdict/components/AiReasoningPanel";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { getTranslator } from "@/lib/i18n/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { getScannerResultDetail, listScannerResultsForOrganization } from "@/server/analysis-runs/list-scanner-results";
import { getFindingsForScanResult } from "@/server/analysis-runs/get-scanner-result-findings";
import { getProductionVerdictByScan } from "@/server/production-verdict/core";
import { verdictExperienceFromVerdict } from "@/brain/production-verdict/experience-view";
import { verdictStatusMessage } from "@/lib/i18n/verdict-copy";
import { formatDurationCompact } from "@/lib/format/duration";
import { formatLocalizedDate, formatRelativeLocalized } from "@/lib/i18n/format";
import { scanResultStatus, scanResultStatusClass } from "@/lib/design-system/scan-status";
import { verdictBadgeClass } from "@/lib/design-system/verdict";
import { verdictStatusLabel } from "@/lib/i18n/verdict-copy";
import { VerdictStatusSchema } from "@/brain/production-verdict/schema";
import { formatPriorityTitleForLocale } from "@/lib/i18n/priority-display";
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
  const { t: tv } = await getTranslator("verdict");
  const { t: tc } = await getTranslator("common");
  const { t: tAll } = await getTranslator();

  const admin = createAdminClient();
  // Server-side tenant scoping: getScannerResultDetail filters by
  // organizationId, so a scanId from another organization returns null here
  // (fail closed) rather than ever being fetched.
  const result = await getScannerResultDetail(admin, {
    organizationId: auth.organizationId,
    scanId,
  });

  if (!result) notFound();

  // These three are independent of one another and of `result` above --
  // fetched concurrently rather than one after another.
  const [verdict, findings, projectHistory] = await Promise.all([
    getProductionVerdictByScan(admin, auth.organizationId, scanId),
    getFindingsForScanResult(admin, auth.organizationId, scanId),
    listScannerResultsForOrganization(admin, { organizationId: auth.organizationId, limit: 50 }),
  ]);

  const status = scanResultStatus(result.status);
  const verdictStatusParsed = VerdictStatusSchema.safeParse(result.verdictStatus);
  const verdictStatus = verdictStatusParsed.success ? verdictStatusParsed.data : null;
  const durationLabel = formatDurationCompact(result.durationMs);
  const scanTypeLabel =
    result.scanType === "incremental" ? t("scanTypeIncremental") : t("scanTypeFull");

  const completedStages = new Set(result.executionTrace.map((entry) => entry.stage));
  const traceByStage = new Map(result.executionTrace.map((entry) => [entry.stage, entry.at]));

  const sameProjectHistory = projectHistory
    .filter((row) => row.projectId === result.projectId && row.scanId !== result.scanId)
    .slice(0, 8);

  const view = verdict
    ? verdictExperienceFromVerdict(verdict, {
        statusMessage: verdictStatusMessage(verdict.status, (key, p) => tAll(key, p)),
      })
    : null;

  const canDeployKey = view
    ? view.status === "ready_to_ship"
      ? "verdict.canIDeploy.yes"
      : view.status === "almost_ready"
        ? "verdict.canIDeploy.almost"
        : view.status === "insufficient_data" || view.status === "analysis_failed"
          ? "verdict.canIDeploy.insufficient"
          : "verdict.canIDeploy.no"
    : null;

  const topPriority = verdict?.topPriorities?.[0] ?? null;

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
          {verdictStatus ? (
            <Badge
              variant="outline"
              className={cn(verdictBadgeClass(verdictStatus), "text-[11px] uppercase tracking-wide")}
            >
              {verdictStatusLabel(verdictStatus, tAll)}
            </Badge>
          ) : null}
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

      {/* 01 · PRODUCTION VERDICT — always visible when a verdict exists for this scan.
          Order matches the report's own hierarchy: decision, then why, then the single
          highest-impact fix, then score/confidence as supporting data -- never the
          other way around. */}
      {verdict && view && canDeployKey ? (
        <section
          aria-labelledby="scan-verdict-heading"
          className="app-surface-metal app-liquid-glow rounded-2xl border border-border/60 p-6 sm:p-8 space-y-6"
        >
          <div className="relative z-[1] space-y-6">
            <div className="space-y-3">
              <VerdictStatusBadge status={view.status} />
              <p id="scan-verdict-heading" className="text-display-headline">
                {tAll(canDeployKey)}
              </p>
            </div>

            {view.executiveSummary ? (
              <div>
                <p className="text-label-caps mb-2">{tv("whyItMatters")}</p>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
                  {view.executiveSummary}
                </p>
              </div>
            ) : null}

            {topPriority ? (
              <RecommendedAction
                eyebrow={t("fixThisFirst")}
                title={formatPriorityTitleForLocale(topPriority, locale)}
                description={topPriority.reason}
              />
            ) : null}

            <div className="flex flex-wrap items-start gap-x-10 gap-y-5 border-t border-border/40 pt-6">
              <div>
                <InfoTip
                  label={tv("productionReadyScore")}
                  title={tv("scoreHelpTitle")}
                  body={tv("scoreHelpBody")}
                />
                <ProductionReadinessScore score={verdict.score} status={view.status} size="secondary" className="mt-2" />
              </div>
              <div>
                <InfoTip
                  label={tv("confidenceLabel")}
                  title={tv("confidenceHelpTitle")}
                  body={tv("confidenceHelpBody")}
                />
                <p className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight leading-none">
                  {tv(`confidenceLevel.${verdict.confidence}`)}
                </p>
              </div>
              <div>
                <InfoTip
                  label={tv("blockersLabel")}
                  title={tv("blockersHelpTitle")}
                  body={tv("blockersHelpBody")}
                />
                <p
                  className={cn(
                    "mt-2 text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight leading-none",
                    verdict.blockersCount > 0 ? "text-danger" : "text-success"
                  )}
                >
                  {verdict.blockersCount}
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          {t("verdictPending")}
        </div>
      )}

      {/* 02 · FINDINGS — grouped, filterable, each individually expandable
          (severity, evidence, reasoning, recommendation) via the same
          component Mission Control already uses. Collapsed by default;
          the section itself opens on click, not automatically. */}
      {findings.length > 0 ? (
        <TechnicalFindingsSection findings={findings} />
      ) : verdict ? (
        <div className="rounded-lg border border-border/50 px-4 py-3 text-sm text-muted-foreground">
          {t("noFindingsForScan")}
        </div>
      ) : null}

      {/* 03 · SECURITY REASONING — only rendered once a verdict exists; the
          panel itself fetches and honestly reports "unavailable" when the
          backend has none for this scan. */}
      {verdict ? (
        <CollapsibleSection title={t("securityReasoning")}>
          <AiReasoningPanel scanId={scanId} />
        </CollapsibleSection>
      ) : null}

      {/* 04 · REPOSITORY — real metadata already loaded for this scan. */}
      <CollapsibleSection title={t("detailRepository")}>
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
            <dt className="text-label-caps">{t("detailFilesAnalyzed")}</dt>
            <dd className="mt-1 text-sm tabular-nums">{result.filesAnalyzed ?? t("durationUnknown")}</dd>
          </div>
        </dl>
      </CollapsibleSection>

      {/* 05 · ANALYSIS DETAILS — technical execution metadata, collapsed by default. */}
      <CollapsibleSection title={t("detailExecution")} description={`${t("detailScanType")}: ${scanTypeLabel}`}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 mb-5">
          <div>
            <dt className="text-label-caps">{t("detailDuration")}</dt>
            <dd className="mt-1 text-sm tabular-nums">{durationLabel ?? t("durationUnknown")}</dd>
          </div>
          <div>
            <dt className="text-label-caps">{t("detailFindings")}</dt>
            <dd className="mt-1 text-sm tabular-nums">
              {result.findingsCount ?? t("durationUnknown")}
            </dd>
          </div>
        </dl>
        {result.executionTrace.length > 0 ? (
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
        ) : (
          <p className="text-sm text-muted-foreground">{t("noExecutionTrace")}</p>
        )}
      </CollapsibleSection>

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

      {/* 06 · PREVIOUS ANALYSES — compact, always visible, scoped to this project. */}
      {sameProjectHistory.length > 0 ? (
        <div className="space-y-3 pt-2">
          <p className="text-label-caps">{t("previousAnalyses")}</p>
          <div className="space-y-1">
            {sameProjectHistory.map((row) => {
              const rowVerdict = VerdictStatusSchema.safeParse(row.verdictStatus);
              return (
                <Link
                  key={row.scanId}
                  href={`/scanner-results/${row.scanId}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-4 py-3 text-sm seq-transition hover:bg-surface-hover seq-focus-ring"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.commitSha ? row.commitSha.slice(0, 7) : t("noCommit")}
                    {row.branch ? ` · ${row.branch}` : ""}
                  </span>
                  <span className="flex items-center gap-3">
                    {rowVerdict.success ? (
                      <Badge variant="outline" className={cn(verdictBadgeClass(rowVerdict.data), "text-[10px] uppercase")}>
                        {verdictStatusLabel(rowVerdict.data, tAll)}
                      </Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatRelativeLocalized(locale, row.createdAt, {
                        never: tc("never"),
                        justNow: tc("justNow"),
                        minutesAgo: tc("minutesAgo"),
                        hoursAgo: tc("hoursAgo"),
                        daysAgo: tc("daysAgo"),
                      })}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
