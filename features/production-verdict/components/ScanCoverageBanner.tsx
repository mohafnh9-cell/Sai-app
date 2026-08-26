"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/types";
import { trackEvent } from "@/lib/analytics/track";
import type { ScanRecord } from "@/features/security-scanner/components/types";
import { scanId as scanIdOf } from "@/features/security-scanner/components/types";

const SIZE_REASONS = new Set([
  "total-limit",
  "file-too-large",
  "max_file_size",
  "max_total_size",
  "max_file_count",
  "max_depth",
]);
const TIME_REASONS = new Set(["time-limit"]);

function dominantReasonLabel(counts: Record<string, number>, t: Translator): string {
  let sizeCount = 0;
  let timeCount = 0;
  let otherCount = 0;
  for (const [reason, count] of Object.entries(counts)) {
    if (SIZE_REASONS.has(reason)) sizeCount += count;
    else if (TIME_REASONS.has(reason)) timeCount += count;
    else otherCount += count;
  }
  if (sizeCount > 0 && timeCount === 0 && otherCount === 0) return t("coverageBanner.sizeLimit");
  if (timeCount > 0 && sizeCount === 0 && otherCount === 0) return t("coverageBanner.timeLimit");
  if (sizeCount > 0 || timeCount > 0) return t("coverageBanner.mixedLimits");
  return t("coverageBanner.otherLimits");
}

function reasonLabel(t: Translator, reason: string): string {
  const key = `coverageBanner.reasons.${reason}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return reason.replace(/[_-]/g, " ");
}

export function ScanCoverageBanner({ scan }: { scan: ScanRecord }) {
  const { t } = useI18n("technicalDetails");
  const [open, setOpen] = useState(false);

  const metrics = scan.metrics ?? {};
  const omissions = Array.isArray(scan.omissions) ? scan.omissions : [];
  const omittedFiles = metrics.omittedFiles ?? omissions.length;
  const truncated = metrics.truncated ?? false;

  if (!truncated && omittedFiles <= 0) return null;

  const analyzed = metrics.scannedFiles ?? scan.files_analyzed ?? 0;
  const total = metrics.inputFiles ?? analyzed + omittedFiles;

  const reasonCounts = omissions.reduce<Record<string, number>>((acc, item) => {
    const reason = item.reason ?? "unknown";
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});
  const groups = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
  const reason = dominantReasonLabel(reasonCounts, t);

  return (
    <section
      className="rounded-xl border border-warning/30 bg-warning/5 p-4"
      aria-labelledby="coverage-banner-heading"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="flex-1">
          <p id="coverage-banner-heading" className="text-sm text-foreground">
            {t("coverageBanner.summary", { analyzed, total, omitted: omittedFiles, reason })}
          </p>

          {groups.length > 0 && (
            <details
              className="mt-2"
              open={open}
              onToggle={(event) => {
                const next = (event.target as HTMLDetailsElement).open;
                setOpen(next);
                if (next) {
                  trackEvent("coverage_omissions_opened", { scanId: scanIdOf(scan) });
                }
              }}
            >
              <summary className="cursor-pointer text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
                {open ? t("coverageBanner.hideDetail") : t("coverageBanner.viewDetail")}
              </summary>
              <ul className="mt-2 space-y-1">
                {groups.map(([groupReason, count]) => (
                  <li
                    key={groupReason}
                    className="flex items-center justify-between text-xs text-muted-foreground"
                  >
                    <span>{reasonLabel(t, groupReason)}</span>
                    <span className="text-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
