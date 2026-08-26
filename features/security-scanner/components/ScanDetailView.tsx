"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  GitBranch,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ProductionVerdictExperience } from "@/features/production-verdict/components/ProductionVerdictExperience";
import { TechnicalFindingsSection } from "@/features/production-verdict/components/TechnicalFindingsSection";
import type { ProductionVerdict } from "@/brain";
import { useI18n } from "@/lib/i18n/client";
import { translateStoredProgressMessage } from "@/lib/i18n/review-progress";
import {
  formatScanDate,
  scanCommit,
  scanDate,
  type ScanFinding,
  type ScanRecord,
} from "./types";
import { trackEvent } from "@/lib/analytics/track";
import { fixPromptContextFromScan } from "@/features/production-verdict/fix-prompt-context";

function statusIsActive(status?: string) {
  return [
    "QUEUED",
    "FETCHING_REPOSITORY",
    "INDEXING",
    "SCANNING",
    "CALCULATING_SCORE",
  ].includes(status?.toUpperCase() ?? "");
}

export function ScanDetailView({
  projectId,
  scanId,
}: {
  projectId: string;
  scanId: string;
}) {
  const { t, locale } = useI18n("projects");
  const { t: tc } = useI18n("common");
  const { t: te } = useI18n("errors");
  const [scan, setScan] = useState<ScanRecord | null>(null);
  const [findings, setFindings] = useState<ScanFinding[]>([]);
  const [verdict, setVerdict] = useState<ProductionVerdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const findingsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/repositories/${projectId}/scans/${scanId}`,
        { cache: "no-store" }
      );
      const body = (await response.json().catch(() => null)) as
        | {
            scan?: ScanRecord;
            findings?: ScanFinding[];
            verdict?: ProductionVerdict | null;
            error?: string;
          }
        | null;
      if (!response.ok || !body?.scan) {
        throw new Error(body?.error || te("scanLoad"));
      }
      setScan(body.scan);
      setFindings(Array.isArray(body.findings) ? body.findings : []);
      setVerdict(body.verdict ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : te("scanLoad"));
    } finally {
      setLoading(false);
    }
  }, [projectId, scanId, te]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (!statusIsActive(scan?.status)) return;
    const timer = window.setInterval(() => void load(true), 4000);
    return () => window.clearInterval(timer);
  }, [load, scan?.status]);

  const scrollToFindings = () => {
    findingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        {tc("states.loadingReview")}
      </div>
    );
  }

  if (error || !scan) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center text-center">
        <AlertCircle className="mb-3 h-9 w-9 text-destructive" aria-hidden />
        <h1 className="font-semibold">{t("unableToLoadScan")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => {
            trackEvent("retry_scan_clicked", { projectId, scanId });
            void load();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> {tc("retry")}
        </Button>
      </div>
    );
  }

  const progress = Math.max(0, Math.min(100, scan.progress ?? 0));
  const active = statusIsActive(scan.status);
  const scanCompleted = !active && scan.status?.toLowerCase() === "completed";
  const verdictV1 = verdict?.v1 ?? null;
  const fixPromptContext = verdictV1
    ? fixPromptContextFromScan({
        detectedStack: scan.detected_stack,
        findings,
        currentVerdictStatus: verdictV1.status,
        currentScore: verdictV1.score,
      })
    : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={`/projects/${projectId}`}>
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> {t("backToProject")}
        </Link>
      </Button>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{t("scanTitle")}</h1>
            <Badge variant="outline">{scan.status || "Unknown"}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{formatScanDate(scanDate(scan))}</span>
            {scan.branch && (
              <span className="flex items-center gap-1">
                <GitBranch className="h-3.5 w-3.5" aria-hidden /> {scan.branch}
              </span>
            )}
            {scanCommit(scan) && <code>{scanCommit(scan)?.slice(0, 12)}</code>}
          </div>
        </div>
      </div>

      {active && (
        <Card>
          <CardContent className="space-y-3 py-5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {tc("states.loadingReview")}
              </span>
              {scan.progress !== undefined && <span>{progress}%</span>}
            </div>
            <Progress value={scan.progress === undefined ? 15 : progress} aria-label={tc("states.buildingVerdict")} />
            <p className="text-xs text-muted-foreground">
              {scan.progress_message
                ? translateStoredProgressMessage(locale, scan.progress_message)
                : tc("states.buildingVerdict")}
            </p>
          </CardContent>
        </Card>
      )}

      {(scan.error_message || scan.error) && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          {scan.error_message || scan.error}
        </div>
      )}

      {verdictV1 && scanCompleted && (
        <ProductionVerdictExperience
          verdict={verdictV1}
          projectId={projectId}
          scanId={scanId}
          scanCompleted={scanCompleted}
          onReviewPriority={scrollToFindings}
          fixPromptContext={fixPromptContext}
          scan={scan}
        />
      )}

      {!verdictV1 && scanCompleted && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("buildingVerdictPersist")}
          </CardContent>
        </Card>
      )}

      <div ref={findingsRef}>
        <TechnicalFindingsSection findings={findings} fixPromptContext={fixPromptContext} />
      </div>
    </div>
  );
}
