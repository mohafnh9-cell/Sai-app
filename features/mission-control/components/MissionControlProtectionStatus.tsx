"use client";

import type { ProtectionCenterSnapshot } from "@/features/continuous-protection/types";
import {
  protectionStatusAccent,
  protectionStatusTone,
} from "@/features/continuous-protection/types";
import { useProtectionCenter } from "@/features/continuous-protection/hooks/useProtectionCenter";
import { useI18n } from "@/lib/i18n/client";
import { formatRelativeLocalized } from "@/lib/i18n/format";

type MissionControlProtectionStatusProps = {
  projectId: string;
  initialData?: ProtectionCenterSnapshot | null;
  enabled?: boolean;
};

function statusLabelKey(status: ProtectionCenterSnapshot["status"]): string {
  return `protection.status.${status}`;
}

function ProtectionStatusSkeleton() {
  return (
    <section
      className="rounded-3xl border border-border/60 bg-card/40 p-6 sm:p-8 space-y-4 animate-pulse"
      aria-busy="true"
      aria-label="Loading protection status"
    >
      <div className="h-3 w-32 rounded bg-muted" />
      <div className="h-8 w-48 rounded bg-muted" />
      <div className="h-4 w-full max-w-md rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-12 rounded bg-muted" />
        <div className="h-12 rounded bg-muted" />
      </div>
    </section>
  );
}

export function MissionControlProtectionStatus({
  projectId,
  initialData = null,
  enabled = true,
}: MissionControlProtectionStatusProps) {
  const { t, locale } = useI18n("missionControl");
  const { t: tc } = useI18n("common");
  const { data: model, isLoading, isFetched } = useProtectionCenter(projectId, initialData, enabled);

  if (isLoading && !model) {
    return <ProtectionStatusSkeleton />;
  }

  if (isFetched && !model) {
    return (
      <section
        className="rounded-3xl border border-dashed border-border/60 bg-card/30 p-6 sm:p-8 text-sm text-muted-foreground"
        role="status"
      >
        {t("protection.unavailable")}
      </section>
    );
  }

  if (!model) return null;

  const relativeLabels = {
    never: tc("never"),
    justNow: tc("justNow"),
    minutesAgo: tc("minutesAgo"),
    hoursAgo: tc("hoursAgo"),
    daysAgo: tc("daysAgo"),
  };

  const lastChecked = model.lastCheckedAt
    ? formatRelativeLocalized(locale, model.lastCheckedAt, relativeLabels)
    : t("protection.lastCheckedNever");

  const showConfidence =
    model.productionConfidence != null || model.securityConfidence != null;

  return (
    <section
      className={`rounded-3xl border p-6 sm:p-8 space-y-5 animate-in fade-in duration-500 ${protectionStatusTone(model.status)}`}
      aria-labelledby="mission-control-protection-heading"
    >
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          {t("protection.eyebrow")}
        </p>
        <p
          id="mission-control-protection-heading"
          className={`text-2xl sm:text-3xl font-semibold tracking-tight break-words ${protectionStatusAccent(model.status)}`}
        >
          {t(statusLabelKey(model.status))}
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">{model.statusHeadline}</p>
      </div>

      {showConfidence && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">{t("protection.productionConfidence")}</p>
            <p className="text-xl font-semibold tabular-nums mt-1">
              {model.productionConfidence != null ? `${model.productionConfidence}%` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("protection.securityConfidence")}</p>
            <p className="text-xl font-semibold tabular-nums mt-1">
              {model.securityConfidence != null ? `${model.securityConfidence}%` : "—"}
            </p>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t("protection.lastChecked")}: {lastChecked}
      </p>

      {model.worriesTop3.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("protection.worriesTitle")}</p>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {model.worriesTop3.map((worry: string) => (
              <li key={worry} className="flex gap-2">
                <span aria-hidden>•</span>
                <span>{worry}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : model.status === "PROTECTED" ? (
        <p className="text-sm text-muted-foreground">{t("protection.nothingUrgent")}</p>
      ) : null}

      <p className="text-sm text-foreground/90">
        <span className="font-medium">{t("protection.recommendation")}: </span>
        {model.recommendation}
      </p>
    </section>
  );
}
