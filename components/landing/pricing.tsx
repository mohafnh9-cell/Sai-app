"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PRICING_PLANS, PRICING_FEATURE_KEYS } from "@/content/landing";
import { useI18n } from "@/lib/i18n/client";

export function Pricing() {
  const { t } = useI18n("landing");

  return (
    <section id="pricing" className="bg-background-deep py-24 md:py-32 lg:py-40">
      <div className="mx-auto max-w-[1200px] px-6">
        <p className="text-[11px] uppercase tracking-[0.24em] text-text-muted">{t("pricing.eyebrow")}</p>
        <h2 className="mt-4 max-w-lg text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
          {t("pricing.title")}
        </h2>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">{t("pricing.subtitle")}</p>

        <div className="mt-16 max-w-lg">
          {PRICING_PLANS.map((plan) => (
            <div
              key={plan.id}
              className="rounded-[20px] border border-brand-violet/30 bg-surface p-8 md:p-10"
              style={{
                boxShadow:
                  "0 0 0 1px rgb(123 92 255 / 0.12), 0 24px 80px rgb(0 0 0 / 0.35)",
              }}
            >
              <h3 className="text-xl font-semibold tracking-[-0.02em]">{t("pricing.planName")}</h3>
              <div className="mt-8 flex items-baseline gap-1">
                <span className="text-5xl font-semibold tracking-[-0.04em]">€{plan.price}</span>
                <span className="text-muted-foreground">{t("pricing.perMonth")}</span>
              </div>

              <ul className="mt-8 space-y-3 border-t border-border pt-8">
                {PRICING_FEATURE_KEYS.map((key) => (
                  <li key={key} className="text-sm text-muted-foreground">
                    {t(`features.${key}`)}
                  </li>
                ))}
              </ul>

              <Button className="mt-10 h-11 w-full rounded-full bg-brand-gradient hover:opacity-90" asChild>
                <Link href="/connect">{t("pricing.cta")}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
