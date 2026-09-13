import dynamic from "next/dynamic";
import type { Metadata } from "next";
import { I18nShell } from "@/components/shared/I18nShell";
import { Hero } from "@/components/landing/hero";
import { LandingNavbar } from "@/components/landing/nav";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Phase 42.5: the public landing migration moved the old React/Tailwind
 * landing off the `/` route in favor of the new static SequrAI landing
 * (app/route.ts, content/landing/index.html). This route keeps the old
 * landing's code reachable and uncompiled-out (not deleted) at a
 * non-public path, per the phase's "do not delete the old landing
 * initially" safety rule, in case of rollback.
 */

const LandingBelowFoldDynamic = dynamic(
  () =>
    import("@/components/landing/landing-below-fold").then((module) => ({
      default: module.LandingBelowFold,
    })),
  {
    loading: () => <div aria-hidden className="min-h-[40vh]" />,
  }
);

export default async function OldLandingPage() {
  const auth = await getServerAuthContext();
  const isAuthenticated = Boolean(auth);

  return (
    <I18nShell namespaces={["common", "navigation", "landing"]}>
      <div className="min-h-app overflow-x-clip bg-background-deep">
        <LandingNavbar isAuthenticated={isAuthenticated} />
        <main>
          <Hero isAuthenticated={isAuthenticated} />
          <LandingBelowFoldDynamic isAuthenticated={isAuthenticated} />
        </main>
      </div>
    </I18nShell>
  );
}
