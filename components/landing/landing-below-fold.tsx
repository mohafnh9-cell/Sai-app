"use client";

import { FinalCTA } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";
import { Pricing } from "@/components/landing/pricing";
import { ProductFlow } from "@/components/landing/product-flow";
import { ProductProof } from "@/components/landing/product-proof";

export function LandingBelowFold() {
  return (
    <>
      <ProductProof />
      <ProductFlow />
      <Pricing />
      <FinalCTA />
      <Footer />
    </>
  );
}
