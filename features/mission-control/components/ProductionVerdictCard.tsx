"use client";

import type { MissionVerdictCard } from "../types";

export function ProductionVerdictCardSection({ verdict }: { verdict: MissionVerdictCard }) {
  const tone =
    verdict.display === "SAFE TO DEPLOY"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : verdict.display === "DEPLOY WITH WARNINGS"
        ? "border-amber-500/30 bg-amber-500/5"
        : verdict.display === "INSUFFICIENT EVIDENCE"
          ? "border-border/60 bg-[#101014]/50"
          : "border-red-500/30 bg-red-500/5";

  return (
    <section
      className={`rounded-3xl border p-8 sm:p-10 space-y-8 ${tone}`}
      aria-labelledby="production-verdict-heading"
    >
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground mb-3">Production Verdict</p>
        <h2 id="production-verdict-heading" className="text-3xl sm:text-4xl font-semibold tracking-tight">
          {verdict.display}
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        <Metric label="Confidence" value={verdict.confidence} />
        <Metric label="Critical campaigns" value={String(verdict.criticalCampaigns)} />
        <Metric label="Replay" value={verdict.replayStatusLabel} />
        <Metric label="Engineering Plan" value={verdict.engineeringPlanStatusLabel} />
        <Metric label="Score" value={String(verdict.score)} />
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
        {verdict.deploymentRecommendation}
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium capitalize">{value}</p>
    </div>
  );
}
