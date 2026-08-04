import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shield } from "lucide-react";
import { OnboardingFlow } from "@/features/onboarding/components/OnboardingFlow";
import { OnboardingPageHeader } from "@/features/onboarding/components/OnboardingPageHeader";
import { getOnboardingContext } from "@/server/onboarding/get-onboarding-context";
import { I18nShell } from "@/components/shared/I18nShell";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Production Verdict | SequrAI" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?redirectTo=/onboarding");

  const params = await searchParams;
  const forcedStep = params.step != null;
  const context = await getOnboardingContext(supabase, user.id);

  if (context.isComplete && !forcedStep) {
    redirect("/dashboard");
  }

  return (
    <I18nShell userId={user.id}>
      <div className="min-h-dvh bg-background bg-[radial-gradient(ellipse_at_top,rgba(var(--primary-rgb,99,102,241),0.08),transparent_50%)]">
        <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-10 px-4 py-8 md:flex-row md:items-start md:justify-center md:py-14">
          <OnboardingPageHeader />
          <Suspense fallback={null}>
            <OnboardingFlow initialContext={context} />
          </Suspense>
        </div>
      </div>
    </I18nShell>
  );
}
