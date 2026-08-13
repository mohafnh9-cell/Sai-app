"use client";

import { useMemo, useState } from "react";
import { Check, ClipboardCopy, ExternalLink, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import {
  buildMcpCursorInstallLink,
  buildMcpManualSetup,
  buildMcpUniversalInstallCommand,
} from "@/lib/mcp/client-config";

type CopyField = "command" | "url" | "authorization" | null;

export function McpUniversalConnect({
  apiKey,
  apiUrl,
}: {
  apiKey: string;
  apiUrl: string;
}) {
  const { t } = useI18n("settings");
  const [copied, setCopied] = useState<CopyField>(null);

  const manual = useMemo(() => buildMcpManualSetup(apiKey, apiUrl), [apiKey, apiUrl]);
  const installCommand = useMemo(
    () => buildMcpUniversalInstallCommand(apiKey, apiUrl),
    [apiKey, apiUrl]
  );
  const cursorInstallLink = useMemo(
    () => buildMcpCursorInstallLink(apiKey, apiUrl),
    [apiKey, apiUrl]
  );

  async function copyValue(field: CopyField, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(field);
    window.setTimeout(() => setCopied(null), 2_000);
  }

  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-5">
      <div className="space-y-1">
        <p className="text-sm font-medium">✓ {t("mcpConnectionCreated")}</p>
        <p className="text-xs text-muted-foreground">{t("mcpUniversalBody")}</p>
      </div>

      <div className="space-y-3 rounded-lg border border-border/60 bg-background/60 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <Terminal className="h-4 w-4 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 space-y-2 flex-1">
            <p className="text-sm font-medium">{t("mcpUniversalCommandTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("mcpUniversalCommandBody")}</p>
            <code className="block overflow-x-auto rounded bg-muted p-3 text-[11px] leading-relaxed">
              {installCommand}
            </code>
            <Button size="sm" onClick={() => void copyValue("command", installCommand)}>
              {copied === "command" ? (
                <>
                  <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {t("mcpCopied")}
                </>
              ) : (
                <>
                  <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {t("mcpUniversalCopyCommand")}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">{t("mcpUniversalManualTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("mcpUniversalManualBody")}</p>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t("mcpUniversalUrlLabel")}</p>
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
          <p className="text-xs font-medium text-muted-foreground">
            {t("mcpUniversalAuthorizationLabel")}
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

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild>
          <a href={cursorInstallLink}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t("mcpUniversalOpenCursor")}
          </a>
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">{t("mcpUniversalSecurityNote")}</p>
    </div>
  );
}
