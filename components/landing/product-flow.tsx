"use client";

import { FLOW_STEP_KEYS } from "@/content/landing";
import { useI18n } from "@/lib/i18n/client";

export function ProductFlow() {
  const { t } = useI18n("landing");

  return (
    <section
      id="how-it-works"
      className="border-t border-border bg-background py-24 md:py-32 lg:py-40"
    >
      <div className="mx-auto max-w-[1200px] px-6">
        <p className="text-[11px] uppercase tracking-[0.24em] text-text-muted">{t("flow.eyebrow")}</p>
        <h2 className="mt-4 max-w-xl text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
          {t("flow.title")}
        </h2>

        <div className="mt-16 grid gap-12 md:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {FLOW_STEP_KEYS.map((stepKey, index) => (
            <div key={stepKey} className="relative">
              {index < FLOW_STEP_KEYS.length - 1 && (
                <span
                  className="absolute left-0 top-5 hidden h-px w-[calc(100%+2rem)] bg-gradient-to-r from-border via-border to-transparent lg:block"
                  aria-hidden
                />
              )}
              <div className="mb-6 flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-brand-violet/80" />
                <span className="text-[11px] tabular-nums text-text-muted">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">
                {t(`flow.steps.${stepKey}.word`)}
              </h3>
              <p className="mt-3 max-w-[16rem] text-sm leading-relaxed text-muted-foreground">
                {t(`flow.steps.${stepKey}.line`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
