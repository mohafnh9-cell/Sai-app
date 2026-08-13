"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";

export function DeleteAccountPanel() {
  const { t } = useI18n("settings");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ confirmation }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? t("deleteAccountFailed"));
      }

      setDone(true);
      window.location.href = "/";
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("deleteAccountFailed"));
      setLoading(false);
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-4">
        <CardTitle className="text-base text-destructive">{t("deleteAccountTitle")}</CardTitle>
        <CardDescription>{t("deleteAccountDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {done ? (
          <p className="text-sm text-muted-foreground">{t("deleteAccountSuccess")}</p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="delete-confirmation">{t("deleteAccountConfirmLabel")}</Label>
              <Input
                id="delete-confirmation"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="DELETE"
                disabled={loading}
                autoComplete="off"
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button
              type="button"
              variant="destructive"
              disabled={loading || confirmation.trim().toUpperCase() !== "DELETE"}
              onClick={() => void handleDelete()}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("deleteAccountCta")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
