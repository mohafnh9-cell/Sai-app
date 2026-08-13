"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BUILDER_PLAN } from "@/lib/billing/builder-plan";
import { useI18n } from "@/lib/i18n/client";
import { trackEvent } from "@/lib/analytics/track";

type StripeCheckoutButtonProps = {
  label: string;
  variant?: "default" | "outline";
  className?: string;
  returnTo?: string;
  onAlreadySubscribed?: () => void;
};

export function StripeCheckoutButton({
  label,
  variant = "default",
  className,
  returnTo,
  onAlreadySubscribed,
}: StripeCheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async () => {
    setLoading(true);
    setError(null);
    trackEvent("checkout_started");

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        alreadySubscribed?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Could not start checkout");
      }

      if (body.alreadySubscribed) {
        onAlreadySubscribed?.();
        if (body.url?.startsWith("/")) {
          window.location.href = body.url;
        }
        return;
      }

      if (body.url) {
        window.location.href = body.url;
        return;
      }

      throw new Error("Checkout URL missing");
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Checkout failed");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        className={className}
        disabled={loading}
        onClick={() => void handleCheckout()}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function BuilderPlanPrice() {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-3xl font-bold">€{BUILDER_PLAN.price}</span>
      <span className="text-sm text-muted-foreground">/month</span>
    </div>
  );
}

export function BuilderPlanFeatures() {
  const { t } = useI18n("billing");
  return (
    <ul className="space-y-2">
      {BUILDER_PLAN.features.map((feature) => (
        <li key={feature} className="text-sm text-muted-foreground">
          {feature}
        </li>
      ))}
      <li className="text-xs text-muted-foreground pt-2">{t("cancelAnytime")}</li>
    </ul>
  );
}
