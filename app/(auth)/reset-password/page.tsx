"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";

export default function ResetPasswordPage() {
  const { t } = useI18n("auth");
  const { t: tc } = useI18n("common");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      setReady(Boolean(data.session));
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError(t("resetPasswordMinLength"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("resetPasswordMismatch"));
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
  };

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center">
        <Link href="/" className="flex items-center gap-2.5 mb-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold">{tc("brand")}</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{t("resetPasswordTitle")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground text-center">
          {t("resetPasswordSubtitle")}
        </p>
      </div>

      {done ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-border/60 bg-secondary/30 p-4 text-sm text-center">
            <p>{t("resetPasswordSuccess")}</p>
          </div>
          <Button className="w-full" asChild>
            <Link href="/login">{t("backToSignIn")}</Link>
          </Button>
        </div>
      ) : !ready ? (
        <div className="rounded-lg border border-border/60 bg-secondary/30 p-4 text-sm text-center space-y-4">
          <p>{t("resetPasswordLinkExpired")}</p>
          <Button variant="outline" className="w-full" asChild>
            <Link href="/forgot-password">{t("forgotPasswordTitle")}</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="password">{t("newPassword")}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("resetPasswordSubmit")}
          </Button>
        </form>
      )}

      <Button variant="ghost" size="sm" className="w-full mt-6" asChild>
        <Link href="/login">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("backToSignIn")}
        </Link>
      </Button>
    </div>
  );
}
