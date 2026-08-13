import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CreditCard, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { BUILDER_PLAN } from "@/lib/billing/builder-plan";
import { getOrganizationSubscription, hasActiveSubscription } from "@/server/billing/subscription-status";
import { resolveActiveWorkspaceIdForUser } from "@/server/workspaces/service";
import { BillingActions } from "@/features/billing/components/BillingActions";
import { getTranslator } from "@/lib/i18n/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; checkout?: string; returnTo?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { t } = await getTranslator("billing");
  const params = await searchParams;

  const organizationId = await resolveActiveWorkspaceIdForUser(supabase, user.id);
  const subscription = organizationId
    ? await getOrganizationSubscription(supabase, organizationId)
    : null;
  const isActive = hasActiveSubscription(subscription);

  const notice =
    params.checkout === "success"
      ? t("checkoutSuccessNotice")
      : params.reason === "subscription_required"
        ? t("subscriptionRequiredNotice")
        : params.checkout === "canceled"
          ? t("checkoutCanceledNotice")
          : null;

  return (
    <div className="p-6 space-y-8 max-w-2xl">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {notice && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          {notice}
        </div>
      )}

      <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-4 py-3">
        <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
        <div>
          <p className="text-sm font-medium">
            {isActive ? t("statusActive") : t("statusPending")}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isActive ? t("statusActiveHelp") : t("statusPendingHelp")}
          </p>
        </div>
        <Badge variant={isActive ? "default" : "secondary"} className="ml-auto shrink-0">
          {isActive ? t("badgeActive") : t("badgePending")}
        </Badge>
      </div>

      <Card className="border-border/50 ring-1 ring-primary/20">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">{BUILDER_PLAN.name}</CardTitle>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-3xl font-bold">€{BUILDER_PLAN.price}</span>
            <span className="text-sm text-muted-foreground">{t("perMonth")}</span>
          </div>
          <CardDescription className="text-xs">{t("planDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <ul className="space-y-2">
            {BUILDER_PLAN.features.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-xs">
                <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                {feature}
              </li>
            ))}
          </ul>
          <Suspense fallback={null}>
            <BillingActions isActive={isActive} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
