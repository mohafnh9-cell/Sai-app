import dynamic from "next/dynamic";
import { I18nShell } from "@/components/shared/I18nShell";
import { Hero } from "@/components/landing/hero";
import { LandingNavbar } from "@/components/landing/nav";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";

const LandingBelowFoldDynamic = dynamic(
  () =>
    import("@/components/landing/landing-below-fold").then((module) => ({
      default: module.LandingBelowFold,
    })),
  {
    loading: () => <div aria-hidden className="min-h-[40vh]" />,
  }
);

export default async function LandingPage() {
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
