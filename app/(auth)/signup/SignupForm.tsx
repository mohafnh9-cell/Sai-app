"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Shield, Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import { OAuthProviderButtons } from "@/features/auth/components/OAuthProviderButtons";

export function SignupForm() {
  const { t } = useI18n("auth");
  const { t: tc } = useI18n("common");
  const searchParams = useSearchParams();
  const redirectTarget = safeNextPath(searchParams.get("redirectTo"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password.length < 8) {
      setError(t("passwordMinLength"));
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    // Deliberately ONE message for every non-error answer of signUp. Supabase answers an already-registered email like a new one (no
    // error, no session) so that the form cannot be used to find out which emails have accounts; this screen must not undo that:
    // it never branches on what signUp returned, and it never claims a message was sent or delivered.
    return (
      <div className="w-full max-w-sm text-center" data-testid="signup-received">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Mail className="h-8 w-8 text-muted-foreground" aria-hidden />
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{t("signupReceivedTitle")}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{t("signupReceivedBody", { email })}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("signupReceivedCheck")}</p>
        <p className="mt-6 text-sm text-muted-foreground">{t("signupReceivedHaveAccount")}</p>
        <div className="mt-2 flex flex-col gap-2">
          <Button className="w-full" asChild>
            <Link href="/login">{t("signupReceivedSignIn")}</Link>
          </Button>
          <Button className="w-full" variant="outline" asChild>
            <Link href="/forgot-password">{t("signupReceivedRecover")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center">
        <Link href="/" className="flex items-center gap-2.5 mb-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold">{tc("brand")}</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{t("signupTitle")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("signupSubtitle")}</p>
      </div>

      <div className="mb-4">
        <OAuthProviderButtons
          redirectTarget={redirectTarget}
          disabled={loading}
          onLoadingChange={setOauthBusy}
        />
      </div>

      <div className="relative mb-4">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs text-muted-foreground">
          <span className="bg-background px-2">{t("orEmail")}</span>
        </div>
      </div>

      <form onSubmit={handleSignup} className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="name">{t("fullName")}</Label>
          <Input
            id="name"
            type="text"
            placeholder="Alex Johnson"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={loading || oauthBusy}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">{t("workEmail")}</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading || oauthBusy}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">{t("password")}</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Min 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading || oauthBusy}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={loading || oauthBusy}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("createAccount")}
        </Button>

        <p className="text-center text-xs text-muted-foreground">{t("termsAgree")}</p>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("hasAccount")}{" "}
        <Link href="/login" className="text-foreground underline underline-offset-4 hover:no-underline">
          {t("signIn")}
        </Link>
      </p>
    </div>
  );
}
