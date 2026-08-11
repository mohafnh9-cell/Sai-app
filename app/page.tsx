import dynamic from "next/dynamic";
import { I18nShell } from "@/components/shared/I18nShell";
import { Hero } from "@/components/landing/hero";
import { LandingNavbar } from "@/components/landing/nav";

const LandingBelowFold = dynamic(
  () =>
    import("@/components/landing/landing-below-fold").then((module) => ({
      default: module.LandingBelowFold,
    })),
  {
    loading: () => <div aria-hidden className="min-h-[40vh]" />,
  }
);

export default function LandingPage() {
  return (
    <I18nShell namespaces={["common", "navigation", "landing"]}>
      <div className="min-h-app overflow-x-clip bg-background-deep">
        <LandingNavbar />
        <main>
          <Hero />
          <LandingBelowFold />
        </main>
      </div>
    </I18nShell>
  );
}
