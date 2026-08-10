"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DynamicTargetAuthorizationStatus } from "@/server/ai-red-team/authorization/dynamic-target-authorization-types";

export function DynamicTargetAuthorizationPanel({
  projectId,
  initialStatus,
}: {
  projectId: string;
  initialStatus: DynamicTargetAuthorizationStatus | null;
}) {
  const router = useRouter();
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

  async function refreshStatus() {
    const response = await fetch(`/api/projects/${projectId}/dynamic-target-authorization`);
    if (!response.ok) {
      setError("No se pudo cargar el estado de autorización.");
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
      throw new Error(body.message ?? body.error ?? "No se pudo completar la auditoría.");
    }
    if (body.awaitingScopeApproval) {
      setAwaitingScopeApproval(true);
      setPhase("verified");
      setMessage(
        "Necesitamos actualizar la autorización de seguridad para comprobar algunos endpoints de tu aplicación."
      );
      router.refresh();
      return;
    }
    setAwaitingScopeApproval(false);
    setPhase(body.dynamicTestsExecuted ? "analyzing" : "verified");
    setMessage(
      dynamicVerificationDecision === "static_only"
        ? "Análisis de código completado. No se realizaron pruebas dinámicas por tu elección."
        : body.timedOut
          ? "La auditoría continúa procesándose. Puedes consultar el progreso en esta pantalla."
          : "Auditoría completada. Los resultados ya incluyen las comprobaciones autorizadas."
    );
    router.refresh();
  }

  async function checkApplication() {
    if (!targetOrigin.trim()) {
      setError("Introduce la URL de tu aplicación.");
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
        body: JSON.stringify({ action: "check", targetOrigin }),
      });
      const body = (await response.json()) as {
        error?: string;
        verified?: boolean;
        authorized?: boolean;
        manualVerificationRequired?: boolean;
      };
      if (!response.ok) {
        setError(body.error ?? "No se pudo comprobar la aplicación.");
        return;
      }
      if (body.verified) {
        setOwnershipConfirmed(true);
        setManualFallback(false);
        setPhase("verified");
        setMessage(
          body.authorized
            ? "Aplicación verificada y autorizada."
            : "Aplicación verificada."
        );
      } else {
        setManualFallback(true);
        setMessage("Necesitamos confirmar que tienes acceso a esta aplicación.");
      }
    } catch (checkError) {
      setError(
        checkError instanceof Error ? checkError.message : "No se pudo comprobar la aplicación."
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
        setError(body.error ?? "No se pudo preparar la verificación.");
        return;
      }
      setInstructions(body.instructions?.instructions ?? null);
      setMessage("Sigue esta última comprobación y después pulsa Verificar aplicación.");
    } catch (manualError) {
      setError(
        manualError instanceof Error ? manualError.message : "No se pudo preparar la verificación."
      );
    } finally {
      setLoading(false);
    }
  }

  async function runAuthorizationFlow() {
    if (!targetOrigin.trim()) {
      setError("Introduce la URL de tu aplicación.");
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
        setError(body.error ?? "No se pudo comprobar la aplicación.");
        return;
      }

      if (body.authorized) {
        setPhase("verified");
        setMessage("Aplicación verificada. Preparando comprobaciones de seguridad...");
        setInstructions(null);
        await runFullAudit("authorize");
      } else if (body.manualVerificationRequired) {
        setMessage(
          "Para proteger a otros usuarios de pruebas no autorizadas necesitamos una última comprobación."
        );
      } else if (body.reason === "production_target_not_supported") {
        setError(
          "La aplicación está vinculada, pero las pruebas dinámicas están desactivadas en producción. Usa un despliegue Preview o Staging."
        );
      } else {
        setError("No se pudo autorizar esta aplicación de forma segura.");
      }
      await refreshStatus();
    } catch (authorizationError) {
      setError(
        authorizationError instanceof Error
          ? authorizationError.message
          : "No se pudo completar la autorización."
      );
    } finally {
      setLoading(false);
      setPhase("idle");
    }
  }

  async function approveScopeExpansion() {
    if (!targetOrigin.trim() && !status?.targetOrigin) {
      setError("Introduce la URL de tu aplicación.");
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
        setError(body.error ?? "No se pudo actualizar la autorización.");
        return;
      }
      setAwaitingScopeApproval(false);
      setMessage(
        body.message ??
          "Vamos a comprobar las rutas necesarias para verificar estas vulnerabilidades."
      );
      await runFullAudit("authorize");
    } catch (scopeError) {
      setError(
        scopeError instanceof Error
          ? scopeError.message
          : "No se pudo actualizar la autorización."
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyApplication() {
    if (!targetOrigin.trim()) {
      setError("Introduce la URL de tu aplicación.");
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
        setMessage("La verificación falló. Revisa el código e inténtalo de nuevo.");
        return;
      }

      const approve = await fetch(`/api/projects/${projectId}/dynamic-target-authorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", targetOrigin, environmentType: "staging" }),
      });
      if (approve.ok) {
        setMessage("Aplicación verificada. Preparando comprobaciones de seguridad...");
        setInstructions(null);
        setOwnershipConfirmed(true);
        await runFullAudit("authorize");
      } else {
        setMessage("Verificación completada. Autoriza las comprobaciones para continuar.");
      }
      await refreshStatus();
    } catch (verificationError) {
      setError(
        verificationError instanceof Error
          ? verificationError.message
          : "No se pudo verificar la aplicación."
      );
    } finally {
      setLoading(false);
    }
  }

  if (!status) {
    return null;
  }

  return (
    <section className="rounded-xl border bg-card p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Verificación de seguridad</h2>
        <p className="text-sm text-muted-foreground">
          SequrAI ha encontrado posibles vulnerabilidades en tu código. Podemos comprobar
          automáticamente si realmente pueden explotarse en tu aplicación.
        </p>
      </div>

      {status.authorized ? (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-emerald-600">Aplicación verificada</p>
          <p>Aplicación: {status.targetOrigin}</p>
          {awaitingScopeApproval ? (
            <>
              <p>
                Vamos a comprobar las rutas necesarias para verificar estas vulnerabilidades.
              </p>
              <Button disabled={loading} onClick={() => void approveScopeExpansion()}>
                Autorizar comprobación
              </Button>
            </>
          ) : (
            <>
              <p>SequrAI ya puede realizar las comprobaciones de seguridad autorizadas.</p>
              <Button
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  void runFullAudit("authorize")
                    .catch((auditError: unknown) =>
                      setError(
                        auditError instanceof Error
                          ? auditError.message
                          : "No se pudo completar la auditoría."
                      )
                    )
                    .finally(() => setLoading(false));
                }}
              >
                {phase === "preparing"
                  ? "Preparando comprobaciones..."
                  : phase === "testing"
                    ? "Ejecutando pruebas controladas..."
                    : phase === "analyzing"
                      ? "Analizando resultados..."
                      : "Ejecutar comprobaciones"}
              </Button>
            </>
          )}
        </div>
      ) : ownershipConfirmed ? (
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-4 text-sm space-y-2">
            <p className="font-medium text-emerald-600">Aplicación verificada</p>
            <p>Aplicación: {targetOrigin}</p>
            <p className="text-muted-foreground">
              Podemos realizar pruebas de seguridad controladas sobre esta aplicación.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={loading} onClick={() => runAuthorizationFlow()}>
              {phase === "preparing" ? "Preparando comprobaciones..." : "Autorizar y comprobar"}
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
                        : "No se pudo completar el análisis de código."
                    )
                  )
                  .finally(() => setLoading(false));
              }}
            >
              Solo analizar el código
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="target-origin">URL de la aplicación</Label>
            <Input
              id="target-origin"
              placeholder="https://miapp.vercel.app"
              value={targetOrigin}
              onChange={(event) => setTargetOrigin(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Ejemplos: https://miapp.com, https://miapp.vercel.app, https://miapp.netlify.app
            </p>
          </div>

          {manualFallback ? (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm space-y-3">
              <p className="font-medium">Necesitamos confirmar que tienes acceso a esta aplicación.</p>
              <p className="text-muted-foreground">
                Puedes verificarla de forma segura para que SequrAI pueda realizar las pruebas.
              </p>
              {!instructions ? (
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => void startManualVerification()}
                >
                  Verificar aplicación
                </Button>
              ) : null}
            </div>
          ) : null}

          {instructions ? (
            <details className="rounded-lg border bg-muted/20 p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                Necesito ayuda para verificar la aplicación
              </summary>
              <p className="mt-3 text-muted-foreground">
                Esta comprobación manual solo es necesaria porque no encontramos una conexión
                autenticada con el proveedor del despliegue.
              </p>
              <pre className="mt-3 whitespace-pre-wrap text-xs">{instructions}</pre>
            </details>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={loading}
              onClick={() => void checkApplication()}
            >
              {phase === "checking" ? "Comprobando aplicación..." : "Continuar"}
            </Button>
            {instructions ? (
              <Button variant="outline" disabled={loading} onClick={() => verifyApplication()}>
                Verificar aplicación
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
                          : "No se pudo completar el análisis de código."
                      )
                    )
                    .finally(() => setLoading(false));
                }}
              >
                Solo analizar el código
              </Button>
            )}
          </div>
        </div>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </section>
  );
}
