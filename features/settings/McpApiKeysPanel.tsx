"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/client";
import {
  buildMcpClientConfig,
  type McpClient,
} from "@/lib/mcp/client-config";

type McpKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
};

export function McpApiKeysPanel() {
  const { t, locale } = useI18n("settings");
  const [keys, setKeys] = useState<McpKeyRow[]>([]);
  const [name, setName] = useState(() => t("mcpKeyNamePlaceholder"));
  const [newKey, setNewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedClient, setCopiedClient] = useState<McpClient | null>(null);

  const apiUrl = useMemo(() => {
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return process.env.NEXT_PUBLIC_APP_URL ?? "https://sequrai-app.vercel.app";
  }, []);
  const configs = useMemo(
    () =>
      newKey
        ? {
            cursor: buildMcpClientConfig("cursor", newKey, apiUrl),
            claude: buildMcpClientConfig("claude", newKey, apiUrl),
            vscode: buildMcpClientConfig("vscode", newKey, apiUrl),
          }
        : null,
    [apiUrl, newKey]
  );

  const loadKeys = useCallback(async () => {
    const response = await fetch("/api/mcp/keys");
    if (!response.ok) {
      setError(t("mcpLoadKeysFailed"));
      return;
    }
    const data = await response.json();
    setKeys(data.keys ?? []);
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadKeys();
    });
  }, [loadKeys]);

  async function createKey() {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/mcp/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? t("mcpCreateKeyFailed"));
        return;
      }
      setNewKey(data.key.rawKey);
      await loadKeys();
    } finally {
      setLoading(false);
    }
  }

  async function revokeKey(id: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/mcp/keys?id=${id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(t("mcpRevokeKeyFailed"));
        return;
      }
      await loadKeys();
    } finally {
      setLoading(false);
    }
  }

  async function copyKey() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
  }

  async function copyConfig(client: McpClient) {
    if (!configs) return;
    await navigator.clipboard.writeText(configs[client]);
    setCopiedClient(client);
    window.setTimeout(() => setCopiedClient(null), 2_000);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="mcp-key-name">{t("mcpKeyNameLabel")}</Label>
        <Input
          id="mcp-key-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("mcpKeyNamePlaceholder")}
        />
      </div>

      <Button size="sm" onClick={createKey} disabled={loading || !name.trim()}>
        {t("mcpGenerateKey")}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {newKey && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <p className="text-sm font-medium">{t("mcpCopyKeyTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("mcpCopyKeyBody")}</p>
          <code className="block text-xs break-all bg-muted p-2 rounded">{newKey}</code>
          <Button size="sm" variant="outline" onClick={copyKey}>
            {copied ? t("mcpCopied") : t("mcpCopyKey")}
          </Button>
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-3">
            <p className="text-sm font-medium">✓ {t("mcpConnectionCreated")}</p>
            <p className="text-xs text-muted-foreground">{t("mcpCursorSetupBody")}</p>
            <p className="text-xs text-muted-foreground">{t("mcpSetupFileHint")}</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">
              {configs?.cursor}
            </pre>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["cursor", "mcpCopyCursorConfig"],
                  ["claude", "mcpCopyClaudeConfig"],
                  ["vscode", "mcpCopyVsCodeConfig"],
                ] as const
              ).map(([client, label]) => (
                <Button
                  key={client}
                  size="sm"
                  variant="outline"
                  onClick={() => void copyConfig(client)}
                >
                  {copiedClient === client ? t("mcpCopied") : t(label)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {keys.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-sm font-medium">{t("mcpActiveKeys")}</p>
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/50 p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{key.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{key.key_prefix}…</p>
                {key.last_used_at && (
                  <p className="text-xs text-muted-foreground">
                    {t("mcpLastUsed", {
                      date: new Date(key.last_used_at).toLocaleDateString(locale),
                    })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="secondary">{t("mcpActiveBadge")}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={loading}
                  onClick={() => revokeKey(key.id)}
                >
                  {t("mcpRevoke")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!newKey ? (
        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t("mcpCursorSetupTitle")}</p>
          <p>{t("mcpCursorSetupBody")}</p>
        </div>
      ) : null}
    </div>
  );
}
