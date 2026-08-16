"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DynamicTargetAuthorizationStatus } from "@/server/ai-red-team/authorization/dynamic-target-authorization-types";
import { normalizeHttpUrlInput } from "@/lib/url/normalize-http-url";
import { useI18n } from "@/lib/i18n/client";
import { AttackSimulationLoadingPanel } from "./AttackSimulationLoadingPanel";

export function DynamicTargetAuthorizationPanel({
  projectId,
  initialStatus,
  skipTargetVerification = false,
}: {
  projectId: string;
  initialStatus: DynamicTargetAuthorizationStatus | null;
  skipTargetVerification?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n("attackCenter");
  const [status, setStatus] = useState(initialStatus);
  const [targetOrigin, setTargetOrigin] = useState(initialStatus?.targetOrigin ?? "");
  const [instructions, setInstructions] = useState<string | null>(
    initialStatus?.verification.instructions ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(
    initialStatus?.verification.status === "verified"
  );
  const [manualFallback, setManualFallback] = useState(
    initialStatus?.verification.status === "pending"
  );
  const [awaitingScopeApproval, setAwaitingScopeApproval] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "checking" | "verified" | "preparing" | "testing" | "analyzing"
  >("idle");

  const runChecksLabel =
    phase === "preparing"
      ? t("dynamicTarget.preparing")
      : phase === "testing"
        ? t("dynamicTarget.testing")
        : phase === "analyzing"
          ? t("dynamicTarget.analyzing")
          : t("dynamicTarget.runChecks");

  async function refreshStatus() {
    const response = await fetch(`/api/projects/${projectId}/dynamic-target-authorization`);
    if (!response.ok) {
      setError(t("dynamicTarget.errors.loadStatus"));
      return;
    }
    const body = (await response.json()) as { status: DynamicTargetAuthorizationStatus };
    setStatus(body.status);
    setInstructions(body.status.verification.instructions);
    if (body.status.targetOrigin) {
      setTargetOrigin(body.status.targetOrigin);
    }
  }

  async function runFullAudit(
    dynamicVerificationDecision: "authorize" | "static_only"
  ) {
    setPhase("preparing");
    const response = await fetch(`/api/projects/${projectId}/full-product-audit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dynamicVerificationDecision }),
    });
    const body = (await response.json()) as {
      error?: string;
      message?: string;
      dynamicTestsExecuted?: boolean;
      timedOut?: boolean;
      awaitingScopeApproval?: boolean;
    };
    if (!response.ok) {
      throw new Error(body.message ?? body.error ?? t("dynamicTarget.errors.auditFailed"));
    }
    if (body.awaitingScopeApproval) {
      setAwaitingScopeApproval(true);
      setPhase("verified");
      setMessage(t("dynamicTarget.messages.scopeUpdateNeeded"));
      router.refresh();
      return;
    }
    setAwaitingScopeApproval(false);
    setPhase(body.dynamicTestsExecuted ? "analyzing" : "verified");
    setMessage(
      dynamicVerificationDecision === "static_only"
        ? t("dynamicTarget.messages.staticOnlyComplete")
        : body.timedOut
          ? t("dynamicTarget.messages.auditContinuing")
          : t("dynamicTarget.messages.auditComplete")
    );
    router.refresh();
  }

  async function checkApplication() {
    const normalizedOrigin = normalizeHttpUrlInput(targetOrigin);
    if (!normalizedOrigin.trim()) {
      setError(t("dynamicTarget.errors.missingUrl"));
      return;
    }
    if (normalizedOrigin !== targetOrigin) {
      setTargetOrigin(normalizedOrigin);
    }
    setLoading(true);
    setPhase("checking");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/dynamic-target-authorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check", targetOrigin: normalizedOrigin }),
      });
      const body = (await response.json()) as {
        error?: string;
        verified?: boolean;
        authorized?: boolean;
        manualVerificationRequired?: boolean;
      };
      if (!response.ok) {
        setError(body.error ?? t("dynamicTarget.errors.checkFailed"));
        return;
      }
      if (body.verified) {
        setOwnershipConfirmed(true);
        setManualFallback(false);
        setPhase("verified");
        setMessage(
          body.authorized
            ? t("dynamicTarget.messages.verifiedAndAuthorized")
            : t("dynamicTarget.messages.verifiedOnly")
        );
      } else {
        setManualFallback(true);
        setMessage(t("dynamicTarget.messages.confirmAccess"));
      }
    } catch (checkError) {
      setError(
        checkError instanceof Error ? checkError.message : t("dynamicTarget.errors.checkFailed")
      );
    } finally {
      setLoading(false);
      setPhase("idle");
    }
  }

  async function startManualVerification() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/dynamic-target-authorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "initiate",
          targetOrigin,
          verificationMethod: "http",
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        instructions?: { instructions?: string };
      };
      if (!response.ok) {
        setError(body.error ?? t("dynamicTarget.errors.prepareVerification"));
        return;
      }
      setInstructions(body.instructions?.instructions ?? null);
      setMessage(t("dynamicTarget.messages.followManualSteps"));
    } catch (manualError) {
      setError(
        manualError instanceof Error
          ? manualError.message
          : t("dynamicTarget.errors.prepareVerification")
      );
    } finally {
      setLoading(false);
    }
  }

  async function runSecurityCheckOnUrl() {
    const normalizedOrigin = normalizeHttpUrlInput(targetOrigin);
    if (!normalizedOrigin.trim()) {
      setError(t("dynamicTarget.errors.missingUrl"));
      return;
    }
    if (normalizedOrigin !== targetOrigin) {
      setTargetOrigin(normalizedOrigin);
    }
    setLoading(true);
    setPhase("checking");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/dynamic-target-authorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "authorize_and_check",
          targetOrigin: normalizedOrigin,
          environmentType: "staging",
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        authorized?: boolean;
        manualVerificationRequired?: boolean;
        verificationSkipped?: boolean;
        reason?: string | null;
      };
      if (!response.ok) {
        setError(body.error ?? t("dynamicTarget.errors.checkFailed"));
        return;
      }

      if (body.authorized) {
        setPhase("verified");
        setOwnershipConfirmed(true);
        setManualFallback(false);
        setInstructions(null);
        setMessage(
          body.verificationSkipped
            ? t("dynamicTarget.messages.checkingSecurity")
            : t("dynamicTarget.messages.verifiedPreparing")
        );
        await runFullAudit("authorize");
      } else if (body.manualVerificationRequired) {
        setManualFallback(true);
        setMessage(t("dynamicTarget.messages.manualVerificationNeeded"));
      } else if (body.reason === "production_target_not_supported") {
        setError(t("dynamicTarget.errors.productionNotSupported"));
      } else {
        setError(t("dynamicTarget.errors.unsafeAuthorization"));
      }
      await refreshStatus();
    } catch (authorizationError) {
      setError(
        authorizationError instanceof Error
          ? authorizationError.message
          : t("dynamicTarget.errors.authorizationFailed")
      );
    } finally {
      setLoading(false);
      setPhase("idle");
    }
  }

  async function runAuthorizationFlow() {
    if (!targetOrigin.trim()) {
      setError(t("dynamicTarget.errors.missingUrl"));
      return;
    }
    setLoading(true);
    setPhase("checking");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/dynamic-target-authorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "authorize_and_check",
          targetOrigin,
          environmentType: "staging",
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        authorized?: boolean;
        manualVerificationRequired?: boolean;
        reason?: string | null;
      };
      if (!response.ok) {
        setError(body.error ?? t("dynamicTarget.errors.checkFailed"));
        return;
      }

      if (body.authorized) {
        setPhase("verified");
        setMessage(t("dynamicTarget.messages.verifiedPreparing"));
        setInstructions(null);
        await runFullAudit("authorize");
      } else if (body.manualVerificationRequired) {
        setMessage(t("dynamicTarget.messages.manualVerificationNeeded"));
      } else if (body.reason === "production_target_not_supported") {
        setError(t("dynamicTarget.errors.productionLinkedDisabled"));
      } else {
        setError(t("dynamicTarget.errors.unsafeAuthorization"));
      }
      await refreshStatus();
    } catch (authorizationError) {
      setError(
        authorizationError instanceof Error
          ? authorizationError.message
          : t("dynamicTarget.errors.authorizeFailed")
      );
    } finally {
      setLoading(false);
      setPhase("idle");
    }
  }

  async function approveScopeExpansion() {
    if (!targetOrigin.trim() && !status?.targetOrigin) {
      setError(t("dynamicTarget.errors.missingUrl"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/dynamic-target-authorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve_scope_expansion",
          targetOrigin: status?.targetOrigin ?? targetOrigin,
        }),
      });
      const body = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setError(body.error ?? t("dynamicTarget.errors.scopeFailed"));
        return;
      }
      setAwaitingScopeApproval(false);
      setMessage(body.message ?? t("dynamicTarget.messages.scopeRoutesHint"));
      await runFullAudit("authorize");
    } catch (scopeError) {
      setError(
        scopeError instanceof Error ? scopeError.message : t("dynamicTarget.errors.scopeFailed")
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyApplication() {
    if (!targetOrigin.trim()) {
      setError(t("dynamicTarget.errors.missingUrl"));
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const verify = await fetch(`/api/projects/${projectId}/dynamic-target-authorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", targetOrigin }),
      });
      const verifyBody = (await verify.json()) as { verified?: boolean; error?: string };
      if (!verify.ok || !verifyBody.verified) {
        setMessage(t("dynamicTarget.messages.verificationFailed"));
        return;
      }

      const approve = await fetch(`/api/projects/${projectId}/dynamic-target-authorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", targetOrigin, environmentType: "staging" }),
      });
      if (approve.ok) {
        setMessage(t("dynamicTarget.messages.verifiedPreparing"));
        setInstructions(null);
        setOwnershipConfirmed(true);
        await runFullAudit("authorize");
      } else {
        setMessage(t("dynamicTarget.messages.verifyThenAuthorize"));
      }
      await refreshStatus();
    } catch (verificationError) {
      setError(
        verificationError instanceof Error
          ? verificationError.message
          : t("dynamicTarget.errors.verifyFailed")
      );
    } finally {
      setLoading(false);
    }
  }

  if (!status) {
    return null;
  }

  const showLoadingPanel =
    loading ||
    phase === "checking" ||
    phase === "preparing" ||
    phase === "testing" ||
    phase === "analyzing";

  const loadingTitle =
    phase === "checking"
      ? t("loadingPanel.checking")
      : phase === "preparing"
        ? t("dynamicTarget.preparing")
        : phase === "testing"
          ? t("dynamicTarget.testing")
          : phase === "analyzing"
            ? t("dynamicTarget.analyzing")
            : t("loadingPanel.title");

  return (
    <section className="rounded-xl border bg-card p-6 space-y-4">
      {showLoadingPanel ? (
        <AttackSimulationLoadingPanel title={loadingTitle} subtitle={t("loadingPanel.subtitle")} progress={48} />
      ) : null}

      <div className={showLoadingPanel ? "opacity-50 pointer-events-none" : undefined}>
      <div>
        <h2 className="text-lg font-semibold">{t("dynamicTarget.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {skipTargetVerification
            ? t("dynamicTarget.descriptionSkipVerification")
            : t("dynamicTarget.descriptionDefault")}
        </p>
      </div>

      {status.authorized ? (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-emerald-600">{t("dynamicTarget.verified")}</p>
          <p>{t("dynamicTarget.applicationLabel", { url: status.targetOrigin ?? "" })}</p>
          {awaitingScopeApproval ? (
            <>
              <p>{t("dynamicTarget.scopeExpansionHint")}</p>
              <Button disabled={loading} onClick={() => void approveScopeExpansion()}>
                {t("dynamicTarget.authorizeScope")}
              </Button>
            </>
          ) : (
            <>
              <p>{t("dynamicTarget.readyToRun")}</p>
              <Button
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  void runFullAudit("authorize")
                    .catch((auditError: unknown) =>
                      setError(
                        auditError instanceof Error
                          ? auditError.message
                          : t("dynamicTarget.errors.auditFailed")
                      )
                    )
                    .finally(() => setLoading(false));
                }}
              >
                {runChecksLabel}
              </Button>
            </>
          )}
        </div>
      ) : ownershipConfirmed ? (
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-4 text-sm space-y-2">
            <p className="font-medium text-emerald-600">{t("dynamicTarget.verified")}</p>
            <p>{t("dynamicTarget.applicationLabel", { url: targetOrigin })}</p>
            <p className="text-muted-foreground">{t("dynamicTarget.canRunControlledTests")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={loading} onClick={() => runAuthorizationFlow()}>
              {phase === "preparing" ? t("dynamicTarget.preparing") : t("dynamicTarget.authorizeAndCheck")}
            </Button>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void runFullAudit("static_only")
                  .catch((auditError: unknown) =>
                    setError(
                      auditError instanceof Error
                        ? auditError.message
                        : t("dynamicTarget.errors.staticAnalysisFailed")
                    )
                  )
                  .finally(() => setLoading(false));
              }}
            >
              {t("dynamicTarget.staticOnly")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="target-origin">{t("dynamicTarget.urlLabel")}</Label>
            <Input
              id="target-origin"
              placeholder={t("dynamicTarget.urlPlaceholder")}
              value={targetOrigin}
              onChange={(event) => setTargetOrigin(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("dynamicTarget.urlHint")}</p>
          </div>

          {manualFallback && !skipTargetVerification ? (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm space-y-3">
              <p className="font-medium">{t("dynamicTarget.manualVerificationTitle")}</p>
              <p className="text-muted-foreground">{t("dynamicTarget.manualVerificationBody")}</p>
              {!instructions ? (
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => void startManualVerification()}
                >
                  {t("dynamicTarget.verifyApplication")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {instructions && !skipTargetVerification ? (
            <details className="rounded-lg border bg-muted/20 p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                {t("dynamicTarget.manualHelpSummary")}
              </summary>
              <p className="mt-3 text-muted-foreground">{t("dynamicTarget.manualHelpBody")}</p>
              <pre className="mt-3 whitespace-pre-wrap text-xs">{instructions}</pre>
            </details>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={loading}
              onClick={() => void (skipTargetVerification ? runSecurityCheckOnUrl() : checkApplication())}
            >
              {phase === "checking"
                ? t("dynamicTarget.checking")
                : skipTargetVerification
                  ? t("dynamicTarget.checkSecurityOnUrl")
                  : t("dynamicTarget.continue")}
            </Button>
            {!skipTargetVerification && instructions ? (
              <Button variant="outline" disabled={loading} onClick={() => verifyApplication()}>
                {t("dynamicTarget.verifyApplication")}
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  void runFullAudit("static_only")
                    .catch((auditError: unknown) =>
                      setError(
                        auditError instanceof Error
                          ? auditError.message
                          : t("dynamicTarget.errors.staticAnalysisFailed")
                      )
                    )
                    .finally(() => setLoading(false));
                }}
              >
                {t("dynamicTarget.staticOnly")}
              </Button>
            )}
          </div>
        </div>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message && !showLoadingPanel ? (
        <p className="text-sm text-muted-foreground">{message}</p>
      ) : null}
      </div>
    </section>
  );
}
