"use client";

import dynamic from "next/dynamic";

const ProductDashboardPreview = dynamic(
  () =>
    import("@/components/landing/product-dashboard-preview").then((module) => ({
      default: module.ProductDashboardPreview,
    })),
  {
    loading: () => (
      <div
        aria-hidden
        className="mx-auto h-[min(420px,55vw)] max-w-[980px] animate-pulse rounded-[20px] border border-border/60 bg-surface/40"
      />
    ),
  }
);

export function HeroDashboardPreview({ className }: { className?: string }) {
  return <ProductDashboardPreview variant="hero" className={className} />;
}
