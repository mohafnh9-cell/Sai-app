"use client";

import { FinalCTA } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";
import { Pricing } from "@/components/landing/pricing";
import { ProductFlow } from "@/components/landing/product-flow";
import { ProductProof } from "@/components/landing/product-proof";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";

export function LandingBelowFold() {
  return (
    <>
      <ProductProof />
      <ProductFlow />
      {isBillingEnabled() ? <Pricing /> : null}
      <FinalCTA />
      <Footer />
    </>
  );
}
