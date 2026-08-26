"use client";

import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { verdictExperienceFromVerdict } from "@/brain/production-verdict/experience-view";
import { ProductionVerdictHero } from "./ProductionVerdictHero";
import { FastestPathForward } from "./FastestPathForward";
import { ProjectedScorePanel } from "./ProjectedScorePanel";
import { ScoreDeltaSummary } from "./ScoreDeltaSummary";
import { CoverageBreakdown } from "./CoverageBreakdown";
import { ScanCoverageBanner } from "./ScanCoverageBanner";
import { ProductionEngineerSummary } from "./ProductionEngineerSummary";
import { trackEvent } from "@/lib/analytics/track";
import { useEffect } from "react";
import { useDemoNavigation } from "@/features/demo/use-demo-navigation";
import type { FixPromptContext } from "../fix-prompt-context";
import type { ScanRecord } from "@/features/security-scanner/components/types";

export function ProductionVerdictExperience({
  verdict,
  projectId,
  scanId,
  scanCompleted = true,
  showEngineer = true,
  onReviewPriority,
  fixPromptContext,
  scan,
}: {
  verdict: ProductionVerdictV1;
  projectId: string;
  scanId?: string;
  scanCompleted?: boolean;
  showEngineer?: boolean;
  onReviewPriority?: () => void;
  fixPromptContext?: FixPromptContext;
  scan?: ScanRecord;
}) {
  const { href } = useDemoNavigation();
  const view = verdictExperienceFromVerdict(verdict);
  const reportHref = scanId
    ? href(`/projects/${projectId}/scans/${scanId}/report`)
    : undefined;
  const retryHref = href(`/projects/${projectId}`);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/demo")) return;
    trackEvent("verdict_viewed", {
      projectId,
      scanId: scanId ?? verdict.scanId,
      status: verdict.status,
      score: verdict.score,
    });
    if (verdict.topPriorities.length > 0) {
      trackEvent("roadmap_viewed", { projectId, scanId: scanId ?? verdict.scanId });
    }
  }, [projectId, scanId, verdict]);

  return (
    <div className="space-y-6">
      <ProductionVerdictHero
        verdict={verdict}
        view={view}
        reportHref={reportHref}
        retryHref={retryHref}
      />

      {verdict.topPriorities.length > 0 && view.status !== "ready_to_ship" && (
        <FastestPathForward
          priorities={verdict.topPriorities}
          onReviewPriority={onReviewPriority}
          fixPromptContext={{
            ...fixPromptContext,
            currentVerdictStatus: verdict.status,
            currentScore: verdict.score,
          }}
        />
      )}

      <ProjectedScorePanel view={view} />
      <ScoreDeltaSummary view={view} />

      {showEngineer && scanId && (
        <ProductionEngineerSummary
          scanId={scanId}
          verdict={verdict}
          scanCompleted={scanCompleted}
        />
      )}

      {scan && <ScanCoverageBanner scan={scan} />}
      <CoverageBreakdown verdict={verdict} />
    </div>
  );
}

export function ProjectVerdictSummary({
  verdict,
  projectId,
  latestScanHref,
}: {
  verdict: ProductionVerdictV1;
  projectId: string;
  lastScanAt?: string | null;
  webhookEnabled?: boolean;
  latestScanHref?: string;
}) {
  const { href } = useDemoNavigation();
  const view = verdictExperienceFromVerdict(verdict);

  return (
    <ProductionVerdictHero
      verdict={verdict}
      view={view}
      variant="product"
      reportHref={
        latestScanHref
          ? latestScanHref.includes("/report")
            ? href(latestScanHref)
            : href(`${latestScanHref}/report`)
          : undefined
      }
      retryHref={href(`/projects/${projectId}`)}
    />
  );
}
