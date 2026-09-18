"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { AgentPicker, type SupportedAgent } from "@/features/mcp/components/AgentPicker";
import { AgentConnectFlow, AgentConnectBackButton } from "@/features/mcp/components/AgentConnectFlow";
import { McpConnectGuide } from "@/features/mcp/components/McpConnectGuide";
import { Button } from "@/components/ui/button";

type View = "picker" | "connecting" | "other" | "connected";

type CreatedKey = { rawKey: string; id: string };

export function OnboardingCursorStep({
  onFinish,
  onSkip,
}: {
  onFinish: () => void;
  onSkip: () => void;
}) {
  const { t } = useI18n("onboarding");
  const { t: ts } = useI18n("settings");
  const [view, setView] = useState<View>("picker");
  const [agent, setAgent] = useState<SupportedAgent | null>(null);
  const [key, setKey] = useState<CreatedKey | null>(null);
  const [hasExistingConnection, setHasExistingConnection] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setKey({ rawKey: data.key.rawKey as string, id: data.key.id as string });
    } finally {
      setLoading(false);
    }
  }, [ts]);

  useEffect(() => {
    queueMicrotask(() => {
      void (async () => {
        try {
          const response = await fetch("/api/mcp/keys");
          const data = (await response.json()) as { keys?: unknown[]; error?: string };
          if ((data.keys?.length ?? 0) > 0) {
            setHasExistingConnection(true);
          }
        } catch {
          // Non-fatal: the picker still works, key creation is retried on selection.
        }
      })();
    });
  }, []);

  const selectAgent = useCallback(
    async (selected: SupportedAgent) => {
      setAgent(selected);
      setView("connecting");
      if (!key) await createKey();
    },
    [createKey, key]
  );

  if (view === "picker") {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-700">
        {hasExistingConnection && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="text-sm font-medium">✓ {t("cursorExistingTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("cursorExistingBody")}</p>
          </div>
        )}
        <AgentPicker onSelect={(a) => void selectAgent(a)} onOther={() => setView("other")} />
        <div className="flex flex-col gap-3">
          <Button variant="ghost" className="w-full" onClick={onSkip}>
            {t("cursorSkip")}
          </Button>
        </div>
      </div>
    );
  }

  if (view === "other") {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-700">
        <AgentConnectBackButton onBack={() => setView("picker")} />
        <div className="space-y-2 text-center sm:text-left">
          <h2 className="text-2xl font-semibold tracking-tight">{t("otherAgentTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("otherAgentSubtitle")}</p>
        </div>
        {loading && !key && (
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
        {!key && !loading && !error && (
          <Button onClick={() => void createKey()}>{t("otherAgentGenerateKey")}</Button>
        )}
        {key && <McpConnectGuide apiKey={key.rawKey} apiUrl={apiUrl} exampleQuestion={t("mcpExamplePrompt")} />}
        <div className="flex flex-col gap-3">
          <Button
            className="w-full h-12 text-base"
            size="lg"
            onClick={onFinish}
            disabled={!key && !hasExistingConnection}
          >
            {t("cursorFinish")}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onSkip}>
            {t("cursorSkip")}
          </Button>
        </div>
      </div>
    );
  }

  // view === "connecting"
  if (!agent) return null;

  if (loading || !key) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-700">
        <AgentConnectBackButton onBack={() => setView("picker")} />
        {loading && (
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
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-700">
      <AgentConnectBackButton onBack={() => setView("picker")} />
      <AgentConnectFlow
        agent={agent}
        apiKey={key.rawKey}
        apiKeyId={key.id}
        apiUrl={apiUrl}
        onConnected={onFinish}
      />
    </div>
  );
}
