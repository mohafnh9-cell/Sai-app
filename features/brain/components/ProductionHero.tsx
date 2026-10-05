"use client";

import { AlertTriangle, Award, Rocket, Sparkles } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  heroScoreDisplay,
  heroViewFromOrgBrain,
  heroViewFromVerdict,
  type ProductionHeroViewModel,
} from "@/brain/production-verdict/hero-view";
import {
  verdictBadgeVariant,
  verdictLabel,
  verdictToneClass,
  shouldShowScore,
} from "@/brain/production-verdict/status-ui";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { OrgBrainSnapshot } from "@/brain";

function HeroContent({ view }: { view: ProductionHeroViewModel }) {
  const showScore = shouldShowScore(view.score, view.status);
  const scoreDisplay = heroScoreDisplay(view);

  if (view.status === "ready_to_ship" && showScore) {
    return (
      <section
        className={`relative overflow-hidden rounded-2xl border p-8 ${verdictToneClass(view.status)}`}
      >
        <div className="absolute top-4 right-4">
          <Badge className="gap-1.5 bg-emerald-600 hover:bg-emerald-600 text-white">
            <Award className="h-3.5 w-3.5" />
            {verdictLabel(view.status)}
          </Badge>
        </div>
        <div className="space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-500">
              Production Verdict
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{view.headline}</h2>
          </div>
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="text-xs text-muted-foreground">Production Ready Score</p>
              <p className="text-5xl font-bold text-emerald-500">{scoreDisplay}</p>
              <p className="text-sm text-muted-foreground">/ 100</p>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2">
              <p className="text-xs text-muted-foreground">Estimated fix time</p>
              <p className="text-lg font-semibold text-emerald-500">
                {view.estimatedFixMinutes} minutes
              </p>
              {view.projectedScore != null && (
                <p className="text-sm font-medium text-emerald-600">
                  Projected {view.projectedScore}/100
                </p>
              )}
            </div>
          </div>
          {view.evaluatedCoverage > 0 && (
            <p className="text-sm text-muted-foreground">
              {view.evaluatedCoverage} production area
              {view.evaluatedCoverage === 1 ? "" : "s"} evaluated
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      className={`relative overflow-hidden rounded-2xl border p-8 ${verdictToneClass(view.status)}`}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3 max-w-2xl">
          <Badge variant={verdictBadgeVariant(view.status)} className="text-xs">
            {verdictLabel(view.status)}
          </Badge>
          <h2 className="text-xl font-bold tracking-tight uppercase sm:text-2xl text-foreground/90">
            {view.headline}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{view.subheadline}</p>
          {view.topPriorityTitle && (
            <p className="text-sm">
              Top priority: <strong>{view.topPriorityTitle}</strong>
            </p>
          )}
        </div>
        <div className="shrink-0 text-center lg:text-right">
          <p className="text-xs text-muted-foreground mb-1">Production Ready Score</p>
          <p className="text-6xl font-bold tabular-nums">
            {showScore ? scoreDisplay : "—"}
          </p>
          {showScore && <p className="text-sm text-muted-foreground">/ 100</p>}
          {!showScore && (
            <p className="text-sm font-medium text-muted-foreground mt-1">More Analysis Required</p>
          )}
          {showScore && view.score !== null && (
            <Progress value={view.score} className="mt-3 h-2 w-48 lg:ml-auto" />
          )}
          {view.scoreDelta != null && view.scoreDelta !== 0 && showScore && (
            <p
              className={`text-sm mt-2 ${view.scoreDelta > 0 ? "text-emerald-500" : "text-red-500"}`}
            >
              {view.scoreDelta > 0 ? "+" : ""}
              {view.scoreDelta} vs previous
            </p>
          )}
        </div>
      </div>

      {view.status === "analysis_failed" && (
        <div className="mt-6 flex flex-col gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
            <span>{view.analysisError ?? "Analysis failed. Re-run the production check."}</span>
          </div>
          <Button variant="outline" size="sm" className="w-fit" asChild>
            <Link href="/projects">Retry production check</Link>
          </Button>
        </div>
      )}

      {view.status === "insufficient_data" && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 shrink-0" />
          Connect a project and run your first production readiness check.
        </div>
      )}

      {showScore && view.blockersCount > 0 && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm">
          <Rocket className="h-4 w-4 text-amber-500 shrink-0" />
          <span>
            <strong>{view.blockersCount}</strong> production blocker
            {view.blockersCount === 1 ? "" : "s"} remaining — follow your Production Roadmap below.
          </span>
        </div>
      )}
    </section>
  );
}

export function ProductionHero({
  verdict,
  orgBrain,
}: {
  verdict?: ProductionVerdictV1 | null;
  orgBrain?: OrgBrainSnapshot | null;
}) {
  if (verdict) {
    return <HeroContent view={heroViewFromVerdict(verdict)} />;
  }
  if (orgBrain) {
    return <HeroContent view={heroViewFromOrgBrain(orgBrain)} />;
  }
  return (
    <HeroContent
      view={{
        status: "insufficient_data",
        score: null,
        scoreDelta: null,
        blockersCount: 0,
        estimatedFixMinutes: 0,
        projectedScore: null,
        topPriorityTitle: null,
        evaluatedCoverage: 0,
        headline: "MORE ANALYSIS REQUIRED",
        affirmsDeploy: false,
        subheadline: "Connect a project and run your first production readiness check.",
        analysisError: null,
      }}
    />
  );
}
