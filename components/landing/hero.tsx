"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeroDashboardPreview } from "@/components/landing/hero-dashboard-preview";
import { FEATURE_KEYS } from "@/content/landing";
import { useI18n } from "@/lib/i18n/client";

export function Hero() {
  const { t } = useI18n("landing");

  return (
    <section className="relative min-h-hero-screen overflow-x-clip pt-16 md:pt-20 safe-top">
      <div className="absolute inset-0 landing-ambient" />
      <div className="landing-glow-orb absolute left-1/2 top-[38%] h-[420px] w-[min(720px,100vw)] rounded-full bg-brand-violet/10 blur-[120px]" />

      <div className="relative mx-auto flex min-h-hero-content max-w-[1200px] flex-col px-6 pb-8 pt-16 md:pt-24 lg:pt-28">
        <div className="mx-auto max-w-[760px] text-center lg:text-left lg:mx-0">
          <p className="landing-reveal text-[11px] font-medium uppercase tracking-[0.28em] text-text-muted">
            {t("hero.eyebrow")}
          </p>

          <h1 className="landing-reveal landing-reveal-delay-1 mt-8 text-[clamp(2.25rem,6vw,3.75rem)] font-semibold leading-[1.05] tracking-[-0.04em]">
            {t("hero.headline")}
          </h1>

          <p className="landing-reveal landing-reveal-delay-2 mt-5 text-sm font-medium tracking-[-0.01em] text-foreground/90 lg:mx-0 mx-auto">
            {t("hero.tagline")}
          </p>

          <p className="landing-reveal landing-reveal-delay-2 mt-6 max-w-[34rem] text-[15px] leading-relaxed text-muted-foreground lg:mx-0 mx-auto">
            {t("hero.subline")}
          </p>

          <p className="landing-reveal landing-reveal-delay-2 mt-6 text-xs text-muted-foreground lg:mx-0 mx-auto">
            {FEATURE_KEYS.map((key) => t(`features.${key}`)).join(" · ")}
          </p>

          <div className="landing-reveal landing-reveal-delay-3 mt-10 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
            <Button
              size="lg"
              className="h-12 rounded-full bg-brand-gradient px-7 text-sm font-medium hover:opacity-90"
              asChild
            >
              <Link href="/connect">{t("hero.ctaPrimary")}</Link>
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="h-12 rounded-full px-7 text-sm text-muted-foreground hover:text-foreground"
              asChild
            >
              <Link href="#how-it-works">{t("hero.ctaSecondary")}</Link>
            </Button>
          </div>

          <p className="landing-reveal landing-reveal-delay-3 mt-5 text-xs text-text-muted">
            {t("hero.footnote")}
          </p>
        </div>

        <div className="landing-reveal landing-reveal-delay-3 relative mt-12 md:mt-16 lg:mt-20">
          <HeroDashboardPreview className="mx-auto max-w-[980px]" />
        </div>
      </div>
    </section>
  );
}
