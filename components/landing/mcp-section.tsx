"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ClipboardCopy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { MCP_CLIENT_KEYS, MCP_LOCAL_TOOLS, MCP_REMOTE_TOOLS } from "@/content/landing";
import { buildMcpClaudeCliCommand, buildMcpClientConfig } from "@/lib/mcp/client-config";

/**
 * Public/anonymous version of the real connect flow -- reuses the exact
 * same command builders as the authenticated Settings panel
 * (features/mcp/components/McpConnectGuide.tsx / lib/mcp/client-config.ts),
 * just with a placeholder key instead of a real one (a landing-page visitor
 * has no SequrAI account yet).
 */
export function McpSection() {
  const { t } = useI18n("landing");
  const [activeClient, setActiveClient] = useState<(typeof MCP_CLIENT_KEYS)[number]>("claudeCode");
  const [copied, setCopied] = useState(false);

  // Server and initial client render must produce identical markup (React
  // hydration requirement) -- start with the same placeholder on both, and
  // only swap in the real origin after mount, once client-only APIs are safe
  // to read.
  const [apiUrl, setApiUrl] = useState("https://your-sequrai-deployment.example.com");
  useEffect(() => {
    // Synchronizing with an external system (the browser's own location),
    // not deriving state from props/state -- the documented exception to
    // "you might not need an effect."
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApiUrl(window.location.origin);
  }, []);

  const snippet = useMemo(() => {
    if (activeClient === "claudeCode") return buildMcpClaudeCliCommand(apiUrl);
    return buildMcpClientConfig("cursor", apiUrl);
  }, [activeClient, apiUrl]);

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context) -- the
      // snippet is still fully visible and selectable, so this is a no-op,
      // never a broken UI.
    }
  }

  return (
    <section id="mcp" className="border-t border-border bg-background-deep py-24 md:py-32 lg:py-40">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-text-muted">{t("mcp.eyebrow")}</p>
            <h2 className="mt-4 max-w-md text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
              {t("mcp.title")}
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              {t("mcp.subtitle")}
            </p>

            <div className="mt-10 space-y-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">{t("mcp.steps.eyebrow")}</p>
              <ol className="mt-4 space-y-4">
                {(["step1", "step2", "step3", "step4"] as const).map((stepKey, index) => (
                  <li key={stepKey} className="flex gap-4">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] tabular-nums text-text-muted">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{t(`mcp.steps.${stepKey}.title`)}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                        {t(`mcp.steps.${stepKey}.line`)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="rounded-[20px] border border-border bg-background p-6 shadow-premium md:p-8">
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">{t("mcp.clientsLabel")}</p>

            <div className="mt-4 flex gap-2" role="tablist" aria-label={t("mcp.clientsLabel")}>
              {MCP_CLIENT_KEYS.map((client) => (
                <button
                  key={client}
                  type="button"
                  role="tab"
                  aria-selected={activeClient === client}
                  onClick={() => setActiveClient(client)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    activeClient === client
                      ? "bg-brand-gradient text-white"
                      : "border border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(`mcp.${client}.name`)}
                </button>
              ))}
            </div>

            <p className="mt-4 text-sm text-muted-foreground">{t(`mcp.${activeClient}.description`)}</p>

            <div className="mt-4 overflow-x-auto rounded-lg border border-border/60 bg-muted/20 p-4">
              <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-foreground/90">
                {snippet}
              </pre>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button size="sm" variant="outline" onClick={() => void copySnippet()} className="gap-2">
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" aria-hidden /> {t("mcp.copied")}
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="h-3.5 w-3.5" aria-hidden /> {t(`mcp.${activeClient}.copyLabel`)}
                  </>
                )}
              </Button>
              <Link href="/mcp" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {t("mcp.docsLink")}
              </Link>
            </div>

            <div className="mt-8 border-t border-border/60 pt-6">
              <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">{t("mcp.toolsRemoteLabel")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {MCP_REMOTE_TOOLS.map((tool) => (
                  <code
                    key={tool}
                    className="rounded-full border border-border/60 bg-muted/20 px-3 py-1 text-[11px] font-mono text-muted-foreground"
                  >
                    {tool}
                  </code>
                ))}
              </div>

              <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-text-muted">{t("mcp.toolsLocalLabel")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {MCP_LOCAL_TOOLS.map((tool) => (
                  <code
                    key={tool}
                    className="rounded-full border border-border/60 bg-muted/20 px-3 py-1 text-[11px] font-mono text-muted-foreground"
                  >
                    {tool}
                  </code>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-20 rounded-[20px] border border-border bg-background p-8 md:p-10">
          <h3 className="max-w-lg text-xl font-semibold tracking-[-0.02em]">{t("mcp.security.title")}</h3>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <p className="text-sm leading-relaxed text-muted-foreground">{t("mcp.security.line1")}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{t("mcp.security.line2")}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{t("mcp.security.line3")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
