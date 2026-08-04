"use client";

import { verdictExperienceFromVerdict } from "@/brain/production-verdict/experience-view";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { verdictToneClass } from "@/brain/production-verdict/status-ui";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { useI18n } from "@/lib/i18n/client";
import { verdictStatusMessage } from "@/lib/i18n/verdict-copy";

/**
 * Single Mission Control hero — answers "Can I deploy?" with no competing metrics or actions.
 */
export function MissionControlHero({ verdict }: { verdict: ProductionVerdictV1 }) {
  const { t } = useI18n();
  const translate = (key: string, params?: Record<string, string | number | null | undefined>) =>
    t(key, params);

  const view = verdictExperienceFromVerdict(verdict, {
    statusMessage: verdictStatusMessage(verdict.status, translate),
  });

  const canDeployKey =
    view.status === "ready_to_ship"
      ? "verdict.canIDeploy.yes"
      : view.status === "almost_ready"
        ? "verdict.canIDeploy.almost"
        : "verdict.canIDeploy.no";

  const tone = verdictToneClass(view.status);

  return (
    <section
      className={`rounded-3xl border p-8 sm:p-10 surface-premium ${tone}`}
      aria-labelledby="mission-control-verdict-heading"
    >
      <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">
        {t("verdict.productionVerdict")}
      </p>
      <p
        id="mission-control-verdict-heading"
        className="mt-4 text-5xl sm:text-6xl font-semibold tracking-tighter leading-none"
      >
        {t(canDeployKey)}
      </p>
      <div className="mt-6">
        <VerdictStatusBadge status={view.status} />
      </div>
    </section>
  );
}
