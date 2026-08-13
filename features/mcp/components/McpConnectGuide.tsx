"use client";

import { useMemo, useState } from "react";
import { Check, ClipboardCopy, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import {
  buildMcpManualSetup,
  buildMcpUniversalInstallCommand,
} from "@/lib/mcp/client-config";

type CopyField = "command" | "url" | "authorization" | "question" | null;

export function McpConnectGuide({
  apiKey,
  apiUrl,
  exampleQuestion,
}: {
  apiKey: string;
  apiUrl: string;
  exampleQuestion?: string;
}) {
  const { t } = useI18n("settings");
  const [copied, setCopied] = useState<CopyField>(null);

  const manual = useMemo(() => buildMcpManualSetup(apiKey, apiUrl), [apiKey, apiUrl]);
  const installCommand = useMemo(
    () => buildMcpUniversalInstallCommand(apiKey, apiUrl),
    [apiKey, apiUrl]
  );
  const prompt = exampleQuestion ?? t("mcpStep3Example");

  async function copyValue(field: CopyField, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(field);
    window.setTimeout(() => setCopied(null), 2_000);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("mcpStep2Title")}</p>
          <p className="text-sm text-muted-foreground">{t("mcpStep2Body")}</p>
        </div>

        <Button className="w-full" onClick={() => void copyValue("command", installCommand)}>
          {copied === "command" ? (
            <>
              <Check className="mr-2 h-4 w-4" aria-hidden />
              {t("mcpCommandCopied")}
            </>
          ) : (
            <>
              <ClipboardCopy className="mr-2 h-4 w-4" aria-hidden />
              {t("mcpCopyCommand")}
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground">{t("mcpKeyOnceNote")}</p>

        <div className="rounded-md border border-border/60 bg-background/50 p-3 space-y-2">
          <p className="text-sm font-medium text-foreground">{t("mcpTroubleshootingTitle")}</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>{t("mcpTroubleshootingRestart")}</li>
            <li>{t("mcpTroubleshootingGreen")}</li>
            <li>{t("mcpTroubleshootingFolder")}</li>
          </ul>
        </div>

        <details className="rounded-md border border-border/60 bg-background/50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            {t("mcpManualToggle")}
          </summary>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            <p>{t("mcpManualStep1")}</p>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide">{t("mcpManualStep2Url")}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="flex-1 overflow-x-auto rounded bg-muted px-3 py-2 text-[11px]">
                  {manual.url}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyValue("url", manual.url)}
                >
                  {copied === "url" ? t("mcpCopied") : t("mcpUniversalCopyUrl")}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide">
                {t("mcpManualStep3Auth")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="flex-1 overflow-x-auto rounded bg-muted px-3 py-2 text-[11px] break-all">
                  {manual.authorization}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyValue("authorization", manual.authorization)}
                >
                  {copied === "authorization" ? t("mcpCopied") : t("mcpUniversalCopyAuthorization")}
                </Button>
              </div>
            </div>
          </div>
        </details>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <MessageCircleQuestion className="h-4 w-4 text-primary" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("mcpStep3Title")}</p>
            <p className="text-sm text-muted-foreground">{t("mcpStep3Body")}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <p className="flex-1 rounded-lg border border-border/60 bg-background px-4 py-3 text-sm font-medium">
            &ldquo;{prompt}&rdquo;
          </p>
          <Button variant="outline" size="sm" onClick={() => void copyValue("question", prompt)}>
            {copied === "question" ? t("mcpCopied") : t("mcpCopyQuestion")}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("mcpSecurityNote")}</p>
    </div>
  );
}
