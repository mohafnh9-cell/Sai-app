"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ClipboardCopy, Loader2, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import {
  buildMcpClaudeCliCommand,
  buildMcpEnvExportCommand,
  buildMcpUniversalInstallCommand,
} from "@/lib/mcp/client-config";
import type { SupportedAgent } from "./AgentPicker";

type ConnectState = "guided" | "checking" | "connected" | "not-yet";

type McpKeyRow = { id: string; last_used_at: string | null };

/**
 * Level-2 guided flow for one already-chosen agent: copy the exact real
 * command, run it, restart, then verify -- reusing the existing
 * mcp_api_keys.last_used_at signal (only ever set by a genuine authenticated
 * call into /api/mcp, see server/mcp/auth.ts) instead of trusting a button
 * click. No new transport, auth, or verification system is introduced.
 */
export function AgentConnectFlow({
  agent,
  apiKey,
  apiKeyId,
  apiUrl,
  onConnected,
}: {
  agent: SupportedAgent;
  apiKey: string;
  apiKeyId: string;
  apiUrl: string;
  onConnected: () => void;
}) {
  const { t } = useI18n("onboarding");
  const [state, setState] = useState<ConnectState>("guided");
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);

  const agentName = agent === "cursor" ? "Cursor" : "Claude Code";

  const envCommand = useMemo(() => buildMcpEnvExportCommand(apiKey), [apiKey]);
  const setupCommand = useMemo(
    () => (agent === "cursor" ? buildMcpUniversalInstallCommand(apiUrl) : buildMcpClaudeCliCommand(apiUrl)),
    [agent, apiUrl]
  );

  const copy = useCallback(async (value: string, which: "env" | "command") => {
    await navigator.clipboard.writeText(value);
    if (which === "env") {
      setCopiedEnv(true);
      window.setTimeout(() => setCopiedEnv(false), 2000);
    } else {
      setCopiedCommand(true);
      window.setTimeout(() => setCopiedCommand(false), 2000);
    }
  }, []);

  const testConnection = useCallback(async () => {
    setState("checking");
    try {
      const response = await fetch("/api/mcp/keys", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { keys?: McpKeyRow[] } | null;
      const key = data?.keys?.find((row) => row.id === apiKeyId);
      if (key?.last_used_at) {
        setState("connected");
      } else {
        setState("not-yet");
      }
    } catch {
      setState("not-yet");
    }
  }, [apiKeyId]);

  if (state === "connected") {
    return (
      <div className="space-y-6 text-center sm:text-left">
        <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-400">
            <Check className="h-4 w-4" aria-hidden /> {t("connectedAgent", { agent: agentName })}
          </p>
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-400">
            <Check className="h-4 w-4" aria-hidden /> {t("connectedAuthenticated")}
          </p>
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-400">
            <Check className="h-4 w-4" aria-hidden /> {t("connectedReady")}
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">{t("connectedTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("connectedSubtitle")}</p>
        </div>
        <Button className="w-full h-12 text-base" size="lg" onClick={onConnected}>
          <Sparkles className="mr-2 h-4 w-4" aria-hidden />
          {t("connectedCta")}
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center sm:text-left">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
          {t("connectFlowEyebrow", { agent: agentName })}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("connectFlowTitle", { agent: agentName })}
        </h2>
        <p className="text-sm text-muted-foreground">{t("connectFlowSubtitle")}</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-border/70 bg-secondary/20 p-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">1. {t("connectStep1Title")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="flex-1 overflow-x-auto rounded bg-muted px-3 py-2 text-[11px] font-mono">
              {envCommand}
            </code>
            <Button size="sm" variant="outline" onClick={() => void copy(envCommand, "env")}>
              {copiedEnv ? <Check className="h-3.5 w-3.5" aria-hidden /> : <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />}
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="flex-1 overflow-x-auto rounded bg-muted px-3 py-2 text-[11px] font-mono">
              {setupCommand}
            </code>
            <Button size="sm" variant="outline" onClick={() => void copy(setupCommand, "command")}>
              {copiedCommand ? <Check className="h-3.5 w-3.5" aria-hidden /> : <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />}
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">2. {t("connectStep2Title")}</p>
          <p className="text-sm text-muted-foreground">{t("connectStep2Body")}</p>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">3. {t("connectStep3Title", { agent: agentName })}</p>
          <p className="text-sm text-muted-foreground">
            {t("connectStep3Body", { agent: agentName })}
          </p>
        </div>
      </div>

      {state === "not-yet" && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("connectNotYetBody")}</p>
        </div>
      )}

      <Button
        className="w-full h-12 text-base"
        size="lg"
        onClick={() => void testConnection()}
        disabled={state === "checking"}
      >
        {state === "checking" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            {t("connectTesting")}
          </>
        ) : (
          t("connectTest")
        )}
      </Button>

      <p className="text-center text-xs text-muted-foreground">{t("mcpWhatIsIt")}</p>
    </div>
  );
}

export function AgentConnectBackButton({ onBack }: { onBack: () => void }) {
  const { t } = useI18n("onboarding");
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground seq-transition"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      {t("connectBack")}
    </button>
  );
}
