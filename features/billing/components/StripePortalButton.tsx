"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

export function StripePortalButton({
  label,
  variant = "outline",
  className,
}: {
  label: string;
  variant?: "default" | "outline";
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePortal = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };

      if (!response.ok || !body.url) {
        throw new Error(body.error ?? "Could not open billing portal");
      }

      window.location.href = body.url;
    } catch (portalError) {
      setError(portalError instanceof Error ? portalError.message : "Portal failed");
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
        onClick={() => void handlePortal()}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
