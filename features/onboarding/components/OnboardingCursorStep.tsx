"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { McpConnectGuide } from "@/features/mcp/components/McpConnectGuide";

export function OnboardingCursorStep({
  onFinish,
  onSkip,
}: {
  onFinish: () => void;
  onSkip: () => void;
}) {
  const { t } = useI18n("onboarding");
  const { t: ts } = useI18n("settings");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasExistingConnection, setHasExistingConnection] = useState(false);

  const apiUrl = useMemo(() => {
    if (typeof window !== "undefined") return window.location.origin;
    return process.env.NEXT_PUBLIC_APP_URL ?? "https://sequrai-app.vercel.app";
  }, []);

  const createKey = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/mcp/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: ts("mcpKeyNamePlaceholder") }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? ts("mcpCreateKeyFailed"));
        return;
      }
      setApiKey(data.key.rawKey as string);
    } finally {
      setLoading(false);
    }
  }, [ts]);

  useEffect(() => {
    queueMicrotask(() => {
      void (async () => {
        setLoading(true);
        try {
          const response = await fetch("/api/mcp/keys");
          const data = (await response.json()) as { keys?: unknown[]; error?: string };
          if (!response.ok) {
            setError(data.error ?? ts("mcpLoadKeysFailed"));
            return;
          }
          if ((data.keys?.length ?? 0) > 0) {
            setHasExistingConnection(true);
            return;
          }
          await createKey();
        } finally {
          setLoading(false);
        }
      })();
    });
  }, [createKey, ts]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-700">
      <div className="space-y-2 text-center sm:text-left">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
          {t("cursorEyebrow")}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">{t("cursorTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("cursorSubtitle")}</p>
      </div>

      <div className="rounded-3xl border border-border/70 bg-gradient-to-b from-secondary/30 to-[#101014]/60 p-6 sm:p-8 space-y-6">
        {loading && !apiKey && (
          <p className="text-sm text-muted-foreground animate-pulse">{t("cursorGeneratingKey")}</p>
        )}

        {error && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={() => void createKey()} disabled={loading}>
              {t("cursorRetryKey")}
            </Button>
          </div>
        )}

        {hasExistingConnection && !apiKey && !error ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <p className="text-sm font-medium">✓ {t("cursorExistingTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("cursorExistingBody")}</p>
            </div>
            <Button variant="outline" onClick={() => void createKey()} disabled={loading}>
              {t("cursorExistingRegenerate")}
            </Button>
          </div>
        ) : null}

        {apiKey ? (
          <McpConnectGuide
            apiKey={apiKey}
            apiUrl={apiUrl}
            exampleQuestion={t("mcpExamplePrompt")}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <Button
          className="w-full h-12 text-base"
          size="lg"
          onClick={onFinish}
          disabled={!apiKey && !hasExistingConnection}
        >
          <Sparkles className="mr-2 h-4 w-4" aria-hidden />
          {t("cursorFinish")}
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
        </Button>
        <Button variant="ghost" className="w-full" onClick={onSkip} disabled={!apiKey && loading}>
          {t("cursorSkip")}
        </Button>
      </div>
    </div>
  );
}
