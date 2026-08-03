import { I18nShell } from "@/components/shared/I18nShell";
import { FinalCTA } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { LandingNavbar } from "@/components/landing/nav";
import { Pricing } from "@/components/landing/pricing";
import { ProductFlow } from "@/components/landing/product-flow";
import { ProductProof } from "@/components/landing/product-proof";

export default function LandingPage() {
  return (
    <I18nShell>
      <div className="min-h-dvh bg-background-deep">
        <LandingNavbar />
        <main>
          <Hero />
          <ProductProof />
          <ProductFlow />
          <Pricing />
          <FinalCTA />
        </main>
        <Footer />
      </div>
    </I18nShell>
  );
}
