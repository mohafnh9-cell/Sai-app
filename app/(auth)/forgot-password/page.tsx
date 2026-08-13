"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";

export default function ForgotPasswordPage() {
  const { t } = useI18n("auth");
  const { t: tc } = useI18n("common");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setSent(true);
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
        <h1 className="text-2xl font-bold tracking-tight">{t("forgotPasswordTitle")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground text-center">
          {t("forgotPasswordSubtitle")}
        </p>
      </div>

      {sent ? (
        <div className="rounded-lg border border-border/60 bg-secondary/30 p-4 text-sm text-center">
          <p>{t("forgotPasswordSent", { email })}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("forgotPasswordSubmit")}
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
