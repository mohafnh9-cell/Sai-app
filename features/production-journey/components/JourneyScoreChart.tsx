"use client";

import { useMemo, useState } from "react";
import type { ProductionJourneyPoint } from "@/brain/production-journey/schema";
import { useI18n } from "@/lib/i18n/client";
import { trackEvent } from "@/lib/analytics/track";

type Range = "7d" | "30d" | "all";

function filterByRange(points: ProductionJourneyPoint[], range: Range): ProductionJourneyPoint[] {
  if (range === "all") return points;
  const days = range === "7d" ? 7 : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return points.filter((p) => new Date(p.generatedAt).getTime() >= cutoff);
}

export function JourneyScoreChart({
  timeline,
}: {
  timeline: ProductionJourneyPoint[];
}) {
  const { t } = useI18n("productionJourney");
  const { locale } = useI18n();
  const [range, setRange] = useState<Range>("all");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chartPoints = useMemo(() => {
    return filterByRange(timeline, range).filter((p) => p.isValidForScoreChart && p.score !== null);
  }, [timeline, range]);

  const width = 640;
  const height = 200;
  const pad = 24;

  const scores = chartPoints.map((p) => p.score as number);
  const minScore = scores.length ? Math.max(0, Math.min(...scores) - 5) : 0;
  const maxScore = scores.length ? Math.min(100, Math.max(...scores) + 5) : 100;

  const coords = chartPoints.map((point, index) => {
    const x =
      pad +
      (chartPoints.length <= 1
        ? (width - pad * 2) / 2
        : (index / (chartPoints.length - 1)) * (width - pad * 2));
    const y =
      pad +
      ((maxScore - (point.score as number)) / Math.max(maxScore - minScore, 1)) *
        (height - pad * 2);
    return { x, y, point };
  });

  const polyline = coords.map((c) => `${c.x},${c.y}`).join(" ");

  const hovered = hoverIndex != null ? coords[hoverIndex] : null;

  return (
    <section aria-labelledby="score-evolution-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="score-evolution-heading" className="text-lg font-semibold">
          {t("scoreEvolution")}
        </h2>
        <div className="flex gap-1 rounded-lg border border-border/60 p-1" role="group" aria-label={t("scoreEvolution")}>
          {(["7d", "30d", "all"] as Range[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setRange(value);
                trackEvent("journey_range_changed", { range: value });
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                range === value
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(value === "7d" ? "range7d" : value === "30d" ? "range30d" : "rangeAll")}
            </button>
          ))}
        </div>
      </div>

      {chartPoints.length < 2 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("oneVerdictTitle")}</p>
      ) : (
        <div className="relative overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full min-w-[320px] max-h-[220px]"
            role="img"
            aria-label={t("chartAlt")}
          >
            <title>{t("chartAlt")}</title>
            {[0, 25, 50, 75, 100].map((tick) => {
              const y =
                pad + ((maxScore - tick) / Math.max(maxScore - minScore, 1)) * (height - pad * 2);
              if (y < pad || y > height - pad) return null;
              return (
                <g key={tick}>
                  <line x1={pad} x2={width - pad} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
                  <text x={4} y={y + 4} className="fill-muted-foreground text-[10px]">
                    {tick}
                  </text>
                </g>
              );
            })}
            {polyline && (
              <polyline
                fill="none"
                stroke="url(#journeyGradient)"
                strokeWidth={2.5}
                strokeLinejoin="round"
                points={polyline}
              />
            )}
            <defs>
              <linearGradient id="journeyGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
            {coords.map((coord, index) => (
              <circle
                key={coord.point.verdictId}
                cx={coord.x}
                cy={coord.y}
                r={hoverIndex === index ? 6 : 4}
                className="fill-primary stroke-background"
                strokeWidth={2}
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(null)}
                onFocus={() => setHoverIndex(index)}
                onBlur={() => setHoverIndex(null)}
                tabIndex={0}
                role="presentation"
              />
            ))}
          </svg>
          {hovered && (
            <div className="mt-2 rounded-lg border border-border/60 bg-secondary/30 p-3 text-xs space-y-1">
              <p>
                {new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(hovered.point.generatedAt))}
              </p>
              <p>
                {t("chartTooltipScore", { score: hovered.point.score ?? "—" })}
                {hovered.point.scoreDelta != null && (
                  <span className={hovered.point.scoreDelta >= 0 ? " text-success" : " text-danger"}>
                    {" "}
                    ({hovered.point.scoreDelta > 0 ? "+" : ""}
                    {hovered.point.scoreDelta})
                  </span>
                )}
              </p>
              {hovered.point.commitSha && <code>{hovered.point.commitSha.slice(0, 12)}</code>}
            </div>
          )}
          <p className="sr-only">
            {chartPoints
              .map((p) =>
                t("chartSrSummary", {
                  date: p.generatedAt,
                  score: p.score ?? t("notAvailable"),
                  delta: p.scoreDelta ?? t("notAvailable"),
                  status: p.status ?? t("notAvailable"),
                })
              )
              .join("; ")}
          </p>
        </div>
      )}
    </section>
  );
}
