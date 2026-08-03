"use client";

import { ProductDashboardPreview } from "@/components/landing/product-dashboard-preview";
import { useI18n } from "@/lib/i18n/client";

export function ProductProof() {
  const { t } = useI18n("landing");

  return (
    <section id="product" className="relative bg-background-deep py-24 md:py-32 lg:py-40">
      <div className="mx-auto max-w-[1200px] px-6">
        <p className="text-[11px] uppercase tracking-[0.24em] text-text-muted">{t("productProof.eyebrow")}</p>
        <h2 className="mt-4 max-w-lg text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
          {t("productProof.title")}
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {t("productProof.subtitle")}
        </p>

        <div className="mt-12">
          <ProductDashboardPreview variant="full" />
        </div>
      </div>
    </section>
  );
}
