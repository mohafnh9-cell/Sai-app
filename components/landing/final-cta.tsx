"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/landing/brand-logo";
import { useI18n } from "@/lib/i18n/client";

export function FinalCTA() {
  const { t } = useI18n("landing");

  return (
    <section className="bg-background py-32 md:py-44 lg:py-52">
      <div className="mx-auto max-w-[760px] px-6 text-center">
        <h2 className="text-[clamp(2rem,6vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.04em]">
          {t("finalCta.headline")}
        </h2>

        <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
          {t("finalCta.subline")}
        </p>

        <Button
          size="lg"
          className="mt-10 h-12 rounded-full bg-brand-gradient px-8 text-sm font-medium hover:opacity-90"
          asChild
        >
          <Link href="/signup">{t("finalCta.button")}</Link>
        </Button>

        <div className="mt-20 flex flex-col items-center gap-2">
          <BrandLogo />
          <p className="text-xs text-text-muted">{t("brand.name")}</p>
        </div>
      </div>
    </section>
  );
}
