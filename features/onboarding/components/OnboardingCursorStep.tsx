"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ClipboardCopy, Sparkles, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { buildMcpClientConfig } from "@/lib/mcp/client-config";

const EXAMPLE_QUESTION = "Can I deploy?";

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
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedQuestion, setCopiedQuestion] = useState(false);
  const [microStep, setMicroStep] = useState<1 | 2 | 3>(1);
  const [hasExistingConnection, setHasExistingConnection] = useState(false);

  const apiUrl = useMemo(() => {
    if (typeof window !== "undefined") return window.location.origin;
    return process.env.NEXT_PUBLIC_APP_URL ?? "https://sequrai-app.vercel.app";
  }, []);

  const mcpJson = useMemo(
    () => (apiKey ? buildMcpClientConfig("cursor", apiKey, apiUrl) : null),
    [apiKey, apiUrl]
  );

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
      setMicroStep(2);
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

  async function copyConfig() {
    if (!mcpJson) return;
    await navigator.clipboard.writeText(mcpJson);
    setCopiedConfig(true);
    setMicroStep(3);
    window.setTimeout(() => setCopiedConfig(false), 2000);
  }

  async function copyKeyOnly() {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setCopiedKey(true);
    window.setTimeout(() => setCopiedKey(false), 2000);
  }

  async function copyQuestion() {
    await navigator.clipboard.writeText(EXAMPLE_QUESTION);
    setCopiedQuestion(true);
    window.setTimeout(() => setCopiedQuestion(false), 2000);
  }

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
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t("cursorStepLabel", { step: microStep })}
        </p>

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

        {apiKey && (
          <>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                <Terminal className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <div className="space-y-1 min-w-0">
                <p className="font-medium">{t("cursorStepOneTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("cursorStepOneBody")}</p>
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <p className="text-sm font-medium">{t("cursorCopyKeyTitle")}</p>
              <code className="block text-xs break-all bg-muted/80 p-3 rounded-lg font-mono">
                {apiKey}
              </code>
              <Button size="sm" variant="outline" onClick={() => void copyKeyOnly()}>
                {copiedKey ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    {t("cursorCopied")}
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    {t("cursorCopyKey")}
                  </>
                )}
              </Button>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">{t("cursorStepTwoTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("cursorStepTwoBody")}</p>
              <pre className="overflow-x-auto rounded-xl border border-border/60 bg-[#0a0a0c] p-4 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {mcpJson}
              </pre>
              <Button className="w-full" size="lg" onClick={() => void copyConfig()}>
                {copiedConfig ? (
                  <>
                    <Check className="mr-2 h-4 w-4" aria-hidden />
                    {t("cursorConfigCopied")}
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="mr-2 h-4 w-4" aria-hidden />
                    {t("cursorCopySetup")}
                  </>
                )}
              </Button>
            </div>

            <div className="rounded-xl border border-border/50 bg-secondary/20 p-4 space-y-3">
              <p className="text-sm font-medium">{t("cursorStepThreeTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("cursorStepThreeBody")}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="flex-1 rounded-lg border border-border/60 bg-background/80 px-4 py-3 text-sm font-medium">
                  &ldquo;{EXAMPLE_QUESTION}&rdquo;
                </p>
                <Button variant="outline" size="sm" onClick={() => void copyQuestion()}>
                  {copiedQuestion ? t("cursorCopied") : t("cursorCopyQuestion")}
                </Button>
              </div>
            </div>
          </>
        )}
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
