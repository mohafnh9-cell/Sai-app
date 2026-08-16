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
import { AttackSimulationFlowSteps } from "./AttackSimulationFlowSteps";
import type { AttackCampaignUiMode } from "../lib/campaign-ui-mode";

async function readJsonResponse<T>(response: Response): Promise<
  | { ok: true; body: T }
  | { ok: false; message: string }
> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      ok: false,
      message: response.ok ? "Empty response" : `Request failed (${response.status})`,
    };
  }
  try {
    return { ok: true, body: JSON.parse(text) as T };
  } catch {
    return {
      ok: false,
      message: text.trim().slice(0, 240),
    };
  }
}

export function DynamicTargetAuthorizationPanel({
  projectId,
  initialStatus,
  skipTargetVerification = false,
  campaignUiMode = "none",
}: {
  projectId: string;
  initialStatus: DynamicTargetAuthorizationStatus | null;
  skipTargetVerification?: boolean;
  campaignUiMode?: AttackCampaignUiMode;
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
    const resetPhase = status?.authorized || ownershipConfirmed ? "verified" : "idle";
    setPhase("preparing");
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/full-product-audit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dynamicVerificationDecision }),
      });
      const parsed = await readJsonResponse<{
        error?: string;
        message?: string;
        dynamicTestsExecuted?: boolean;
        timedOut?: boolean;
        awaitingScopeApproval?: boolean;
      }>(response);

      if (!parsed.ok) {
        throw new Error(parsed.message);
      }

      const body = parsed.body;
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
      setPhase(resetPhase);
      setMessage(
        dynamicVerificationDecision === "static_only"
          ? t("dynamicTarget.messages.staticOnlyComplete")
          : body.timedOut
            ? t("dynamicTarget.messages.simulationRunningBelow")
            : t("dynamicTarget.messages.auditComplete")
      );
      router.refresh();
    } catch (auditError) {
      setPhase(resetPhase);
      throw auditError;
    }
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
    }
  }

  async function startManualVerification() {
    setLoading(true);
    setPhase("checking");
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
      setPhase((current) => (current === "checking" ? "idle" : current));
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
      setPhase((current) =>
        current === "preparing" || current === "testing" || current === "analyzing" || current === "verified"
          ? current
          : "idle"
      );
    }
  }

  async function runAuthorizationFlow() {
    if (!targetOrigin.trim()) {
      setError(t("dynamicTarget.errors.missingUrl"));
      return;
    }
    setLoading(true);
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
      setPhase((current) =>
        current === "preparing" || current === "testing" || current === "analyzing" || current === "verified"
          ? current
          : "idle"
      );
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
      setPhase((current) =>
        current === "preparing" || current === "testing" || current === "analyzing" || current === "verified"
          ? current
          : "idle"
      );
    }
  }

  async function verifyApplication() {
    if (!targetOrigin.trim()) {
      setError(t("dynamicTarget.errors.missingUrl"));
      return;
    }
    setLoading(true);
    setPhase("checking");
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
      setPhase((current) =>
        current === "preparing" || current === "testing" || current === "analyzing" || current === "verified"
          ? current
          : "idle"
      );
    }
  }

  if (!status) {
    return null;
  }

  const isAttackRunning =
    phase === "preparing" || phase === "testing" || phase === "analyzing";
  const isVerificationRunning = (loading || phase === "checking") && !isAttackRunning;

  const flowStep: 1 | 2 | 3 =
    status.authorized || isAttackRunning || ownershipConfirmed
      ? 3
      : manualFallback || phase === "checking" || instructions
        ? 2
        : 1;

  const showCampaignSummary = campaignUiMode !== "none" && status.authorized;

  return (
    <section className="rounded-xl border bg-card p-6 space-y-5">
      {!showCampaignSummary ? <AttackSimulationFlowSteps currentStep={flowStep} /> : null}

      {isAttackRunning ? (
        <AttackSimulationLoadingPanel
          variant="attack"
          title={
            phase === "preparing"
              ? t("dynamicTarget.preparing")
              : phase === "testing"
                ? t("dynamicTarget.testing")
                : t("dynamicTarget.analyzing")
          }
          subtitle={t("loadingPanel.subtitle")}
          progress={phase === "analyzing" ? 72 : phase === "testing" ? 48 : 28}
        />
      ) : null}

      {isVerificationRunning ? (
        <AttackSimulationLoadingPanel
          variant="verification"
          title={
            phase === "checking"
              ? t("loadingPanel.checking")
              : t("loadingPanel.verifyingTitle")
          }
          subtitle={t("loadingPanel.verifyingSubtitle")}
          progress={36}
        />
      ) : null}

      <div className={isAttackRunning ? "opacity-50 pointer-events-none space-y-4" : "space-y-4"}>
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
          {showCampaignSummary ? (
            <p className="text-muted-foreground">
              {campaignUiMode === "running"
                ? t("dynamicTarget.messages.simulationRunningBelow")
                : t("dynamicTarget.messages.resultsBelow")}
            </p>
          ) : awaitingScopeApproval ? (
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
                disabled={loading || isAttackRunning}
                onClick={() => {
                  setLoading(true);
                  setError(null);
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
                  {t("dynamicTarget.getVerificationInstructions")}
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
            {!skipTargetVerification && (manualFallback || instructions) ? (
              <Button variant="outline" disabled={loading} onClick={() => void verifyApplication()}>
                {t("dynamicTarget.verifyApplication")}
              </Button>
            ) : null}
          </div>

          {!skipTargetVerification ? (
            <details className="rounded-lg border border-border/50 bg-muted/10 px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                {t("dynamicTarget.advancedOptions")}
              </summary>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
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
                <p className="mt-2 text-xs text-muted-foreground">{t("dynamicTarget.staticOnlyHint")}</p>
              </div>
            </details>
          ) : null}
        </div>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message && !showCampaignSummary ? (
        <p className="text-sm text-muted-foreground">{message}</p>
      ) : null}
      </div>
    </section>
  );
}
