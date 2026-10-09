"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

type ConsentPayload = {
  requestId: string;
  clientName: string;
  clientId: string;
  organizationId: string;
  organizationName?: string | null;
  scopes: { scope: string; description: string; descriptionEs?: string; sensitive?: boolean; defaultGranted?: boolean }[];
  redirectUri: string;
};

function OAuthConsentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useI18n("settings");
  const requestId = searchParams.get("request_id");

  const [payload, setPayload] = useState<ConsentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // What the person grants. Sensitive capabilities (start reviews/audits, authorize security tests) start UNCHECKED.
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadConsent = useCallback(async () => {
    if (!requestId) {
      setError(t("oauthConsentMissingRequest"));
      setLoading(false);
      return;
    }

    const response = await fetch(`/api/oauth/consent?request_id=${encodeURIComponent(requestId)}`);
    if (!response.ok) {
      setError(t("oauthConsentLoadFailed"));
      setLoading(false);
      return;
    }

    const data = await response.json();
    setPayload(data);
    setSelected(
      (data as ConsentPayload).scopes
        .filter((item) => item.defaultGranted ?? !item.sensitive)
        .map((item) => item.scope)
    );
    setLoading(false);
  }, [requestId, t]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadConsent();
    });
  }, [loadConsent]);

  async function handleAction(action: "approve" | "deny") {
    if (!requestId) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/oauth/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId, action, ...(action === "approve" ? { scopes: selected } : {}) }),
      });

      const data = await response.json();
      if (!response.ok || !data.redirectTo) {
        setError(data.error ?? t("oauthConsentActionFailed"));
        setSubmitting(false);
        return;
      }

      window.location.href = data.redirectTo;
    } catch {
      setError(t("oauthConsentActionFailed"));
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-12 px-4">
        <p className="text-sm text-destructive">{error ?? t("oauthConsentLoadFailed")}</p>
        <Button variant="outline" onClick={() => router.push("/settings")}>
          {t("oauthConsentBackToSettings")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-12 px-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Shield className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{t("oauthConsentTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("oauthConsentSubtitle", { client: payload.clientName })}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-1">
        <p className="text-xs text-muted-foreground">{t("oauthConsentWorkspace")}</p>
        <p className="text-sm font-semibold" data-testid="oauth-consent-workspace">
          {payload.organizationName ?? payload.organizationId}
        </p>
        <p className="text-xs text-muted-foreground">{t("oauthConsentWorkspaceNote")}</p>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
        <p className="text-sm font-medium">{t("oauthConsentCapabilities")}</p>
        <ul className="space-y-3 text-sm text-muted-foreground">
          {payload.scopes.map((item) => {
            const inputId = `oauth-scope-${item.scope}`;
            return (
              <li key={item.scope} className="flex items-start gap-2">
                <input
                  id={inputId}
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  checked={selected.includes(item.scope)}
                  disabled={submitting}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked ? [...current, item.scope] : current.filter((scope) => scope !== item.scope)
                    )
                  }
                />
                <label htmlFor={inputId} className="space-y-0.5">
                  <span className="block text-foreground">{locale === "es" ? item.descriptionEs ?? item.description : item.description}</span>
                  {item.sensitive ? (
                    <span className="block text-xs text-warning">{t("oauthConsentSensitiveNote")}</span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
        {selected.length === 0 ? (
          <p className="text-xs text-destructive">{t("oauthConsentNothingSelected")}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("oauthConsentRemoteOnly")}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" disabled={submitting || selected.length === 0} onClick={() => void handleAction("approve")}>
          {submitting ? t("oauthConsentSubmitting") : t("oauthConsentApprove")}
        </Button>
        <Button
          className="flex-1"
          variant="outline"
          disabled={submitting}
          onClick={() => void handleAction("deny")}
        >
          {t("oauthConsentDeny")}
        </Button>
      </div>
    </div>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      }
    >
      <OAuthConsentForm />
    </Suspense>
  );
}
