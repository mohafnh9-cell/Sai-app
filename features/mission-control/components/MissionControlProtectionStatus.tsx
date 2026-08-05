"use client";

import type { ProtectionCenterSnapshot } from "@/features/continuous-protection/types";
import {
  protectionStatusAccent,
  protectionStatusTone,
} from "@/features/continuous-protection/types";
import { useI18n } from "@/lib/i18n/client";
import { formatRelativeLocalized } from "@/lib/i18n/format";

export function MissionControlProtectionStatus({
  model,
}: {
  model: ProtectionCenterSnapshot;
}) {
  const { t, locale } = useI18n("missionControl");
  const { t: tc } = useI18n("common");

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
          {t(`protection.status.${model.status}`)}
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

      {model.worriesTop3?.length ? (
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
