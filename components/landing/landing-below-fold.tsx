"use client";

import { FinalCTA } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";
import { McpSection } from "@/components/landing/mcp-section";
import { Pricing } from "@/components/landing/pricing";
import { ProductFlow } from "@/components/landing/product-flow";
import { ProductProof } from "@/components/landing/product-proof";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";

export function LandingBelowFold({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  return (
    <>
      <ProductProof />
      <ProductFlow />
      <McpSection />
      {isBillingEnabled() ? <Pricing /> : null}
      <FinalCTA isAuthenticated={isAuthenticated} />
      <Footer />
    </>
  );
}
