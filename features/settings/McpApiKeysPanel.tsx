"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/client";
import { McpConnectGuide } from "@/features/mcp/components/McpConnectGuide";

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

  const apiUrl = useMemo(() => {
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return process.env.NEXT_PUBLIC_APP_URL ?? "https://sequrai-app.vercel.app";
  }, []);

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
      if (newKey) setNewKey(null);
      await loadKeys();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {!newKey ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
          <p className="text-sm font-medium">{t("mcpStep1Title")}</p>
          <p className="text-sm text-muted-foreground">{t("mcpBeforeConnect")}</p>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-key-name">{t("mcpKeyNameLabel")}</Label>
            <Input
              id="mcp-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("mcpKeyNamePlaceholder")}
            />
          </div>
          <Button onClick={createKey} disabled={loading || !name.trim()}>
            {loading ? t("mcpGeneratingKey") : t("mcpGenerateKey")}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-emerald-400">✓ {t("mcpStep1Done")}</p>
          <McpConnectGuide apiKey={newKey} apiUrl={apiUrl} />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {keys.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/50">
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
          {!newKey ? (
            <p className="text-xs text-muted-foreground">{t("mcpRegenerateHint")}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
