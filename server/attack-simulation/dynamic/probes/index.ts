import type { SafeRuntimeStepResult } from "../../runtime/types";
import type { AuthorizedDynamicTarget, DynamicTargetFixtures } from "../authorized-target";
import { resolveProbePath } from "../authorized-target";
import type { DynamicHttpClient, DynamicHttpResponseEvidence } from "../http-client";

export const DYNAMIC_CAPABLE_ADAPTER_IDS = new Set([
  "unauthenticated-endpoint",
  "idor-cross-tenant",
  "webhook-signature-bypass",
  "rate-limit-brute-force",
  "idempotency-replay",
  "mass-assignment-probe",
  "privilege-escalation",
  "security-headers-probe",
  "injection-probe-safe",
  "ssrf-probe-safe",
  "cors-misconfiguration",
]);

export type DynamicProbeInput = {
  adapterId: string;
  target: AuthorizedDynamicTarget;
  client: DynamicHttpClient;
  fixtures?: DynamicTargetFixtures;
  correlationId: string;
};

function completed(
  input: DynamicProbeInput,
  observedBehavior: string,
  statusCode: number,
  sideEffects: Record<string, unknown>,
  classification: SafeRuntimeStepResult["classification"]
): SafeRuntimeStepResult {
  return {
    outcome: "completed",
    classification,
    expectedBehavior: "Authorized dynamic security probe completes safely",
    observedBehavior,
    statusCode,
    sideEffects: { ...sideEffects, dynamic: true },
    auditTrail: [`dynamic:${input.adapterId}`, `correlation:${input.correlationId}`],
    durationMs: 0,
  };
}

function evidenceSummary(response: DynamicHttpResponseEvidence): Record<string, unknown> {
  return {
    endpoint: response.url,
    method: response.method,
    status: response.status,
    durationMs: response.durationMs,
    bodyLength: response.bodyLength,
    bodyFingerprint: response.bodyFingerprint,
    bodyPreview: response.bodyPreview,
    testIdentity: response.testIdentity,
    timestamp: response.timestamp,
  };
}

async function probeUnauthenticatedEndpoint(input: DynamicProbeInput): Promise<SafeRuntimeStepResult> {
  const path = resolveProbePath(input.target, input.fixtures, "unauthenticated");
  const unauth = await input.client.request({ method: "GET", path, label: "anonymous" });
  const auth = await input.client.request({
    method: "GET",
    path: resolveProbePath(input.target, input.fixtures, "authenticated"),
    headers: { authorization: `Bearer ${input.target.testIdentities.userA?.token ?? "test-token-user-a"}` },
    label: "authenticated",
  });

  const vulnerable = unauth.status >= 200 && unauth.status < 300 && unauth.bodyLength > 0;
  return completed(
    input,
    vulnerable
      ? `Unauthenticated GET ${path} returned ${unauth.status} with response body (authenticated comparison: ${auth.status})`
      : `Unauthenticated GET ${path} rejected with ${unauth.status}; authentication enforced`,
    unauth.status,
    {
      unauthenticated: evidenceSummary(unauth),
      authenticatedComparison: evidenceSummary(auth),
      unauthenticatedAccess: vulnerable,
    },
    input.target.attackMode === "sandbox" ? "sandbox" : "authorized_staging"
  );
}

async function probeIdorCrossTenant(input: DynamicProbeInput): Promise<SafeRuntimeStepResult> {
  const foreignPath = resolveProbePath(input.target, input.fixtures, "idorResourceB");
  const response = await input.client.request({
    method: "GET",
    path: foreignPath,
    headers: { authorization: `Bearer ${input.target.testIdentities.userA?.token ?? "test-token-user-a"}` },
    label: "user_a",
  });
  const vulnerable = response.status >= 200 && response.status < 300 && /user-b|foreign|cross-tenant|tenant-b/i.test(response.bodyPreview);
  return completed(
    input,
    vulnerable
      ? `Cross-tenant access: User A retrieved foreign tenant resource ${foreignPath} with ${response.status}`
      : `Foreign resource access blocked (${response.status}) for User A`,
    response.status,
    { crossTenantAccess: vulnerable, response: evidenceSummary(response) },
    input.target.attackMode === "sandbox" ? "sandbox" : "authorized_staging"
  );
}

async function probeRateLimitBruteForce(input: DynamicProbeInput): Promise<SafeRuntimeStepResult> {
  const path = resolveProbePath(input.target, input.fixtures, "rateLimitVulnerable");
  const maxProbe = Math.min(12, input.target.maxRequestBudget);
  let accepted = 0;
  let blocked = 0;
  let lastStatus = 0;
  let retryAfter = false;

  for (let index = 0; index < maxProbe; index += 1) {
    const response = await input.client.request({
      method: "POST",
      path,
      body: { email: `probe-${index}@sequrai.test`, password: "probe" },
      label: "rate_probe",
    });
    lastStatus = response.status;
    if (response.status === 429) {
      blocked += 1;
      retryAfter = Boolean(response.headers["retry-after"]);
    } else if (response.status >= 200 && response.status < 500) {
      accepted += 1;
    }
  }

  const vulnerable = accepted >= maxProbe && blocked === 0;
  return completed(
    input,
    vulnerable
      ? `${maxProbe} rapid requests to ${path}: ${accepted} accepted, ${blocked} blocked (no rate limiting)`
      : `Rate limiting observed: ${accepted} accepted, ${blocked} blocked (429=${blocked > 0})`,
    lastStatus,
    {
      requestsSent: maxProbe,
      requestsAccepted: accepted,
      requestsBlocked: blocked,
      retryAfter,
      noRateLimiting: vulnerable,
    },
    input.target.attackMode === "sandbox" ? "sandbox" : "authorized_staging"
  );
}

async function probeWebhookSignatureBypass(input: DynamicProbeInput): Promise<SafeRuntimeStepResult> {
  const path = resolveProbePath(input.target, input.fixtures, "webhook");
  const invalid = await input.client.request({
    method: "POST",
    path,
    headers: { "x-signature": "invalid-signature" },
    body: { event: "test", amount: 1 },
    label: "invalid_signature",
  });
  const missing = await input.client.request({
    method: "POST",
    path,
    body: { event: "test", amount: 1 },
    label: "missing_signature",
  });
  const vulnerable = [invalid, missing].some((response) => response.status >= 200 && response.status < 300);
  return completed(
    input,
    vulnerable
      ? "Webhook accepted invalid or missing signature"
      : "Webhook rejected invalid/missing signatures",
    invalid.status,
    {
      invalidSignature: evidenceSummary(invalid),
      missingSignature: evidenceSummary(missing),
      signatureBypass: vulnerable,
    },
    input.target.attackMode === "sandbox" ? "sandbox" : "authorized_staging"
  );
}

async function probeIdempotencyReplay(input: DynamicProbeInput): Promise<SafeRuntimeStepResult> {
  const path = resolveProbePath(input.target, input.fixtures, "idempotent");
  const key = `sequrai-probe-${input.correlationId.slice(0, 8)}`;
  const first = await input.client.request({
    method: "POST",
    path,
    headers: { "idempotency-key": key },
    body: { action: "safe-probe" },
    label: "first",
  });
  const replay = await input.client.request({
    method: "POST",
    path,
    headers: { "idempotency-key": key },
    body: { action: "safe-probe" },
    label: "second",
  });
  const protectedRun =
    replay.bodyPreview.includes("sameResult") ||
    /same-result|cached|idempotent/i.test(replay.bodyPreview);
  const extraEffectObserved =
    first.status >= 200 &&
    replay.status >= 200 &&
    !protectedRun &&
    first.bodyFingerprint !== replay.bodyFingerprint;
  return completed(
    input,
    extraEffectObserved
      ? "Idempotency retry produced a different side effect"
      : protectedRun
        ? "Duplicate prevented: second request returned cached idempotent result without additional side effect"
        : "Idempotency behavior inconclusive",
    replay.status,
    {
      firstRequest: evidenceSummary(first),
      secondRequest: evidenceSummary(replay),
      extraEffectObserved,
      idempotencyEnforced: protectedRun,
    },
    input.target.attackMode === "sandbox" ? "sandbox" : "authorized_staging"
  );
}

async function probeMassAssignment(input: DynamicProbeInput): Promise<SafeRuntimeStepResult> {
  const path = resolveProbePath(input.target, input.fixtures, "massAssignment");
  const response = await input.client.request({
    method: "POST",
    path,
    headers: { authorization: `Bearer ${input.target.testIdentities.userA?.token ?? "test-token-user-a"}` },
    body: { name: "probe", role: "admin" },
    label: "user_a",
  });
  const vulnerable = /admin|privileged|role":"admin/i.test(response.bodyPreview);
  return completed(
    input,
    vulnerable
      ? "Privileged field role=admin accepted in request body"
      : "Privileged fields were stripped or rejected",
    response.status,
    { privilegedFieldAccepted: vulnerable, response: evidenceSummary(response) },
    input.target.attackMode === "sandbox" ? "sandbox" : "authorized_staging"
  );
}

async function probePrivilegeEscalation(input: DynamicProbeInput): Promise<SafeRuntimeStepResult> {
  const path = resolveProbePath(input.target, input.fixtures, "privilegeEscalation");
  const response = await input.client.request({
    method: "GET",
    path,
    headers: { authorization: `Bearer ${input.target.testIdentities.userA?.token ?? "test-token-user-a"}` },
    label: "standard_user",
  });
  const vulnerable = response.status >= 200 && response.status < 300 && /admin|privileged/i.test(response.bodyPreview);
  return completed(
    input,
    vulnerable
      ? "Standard user accessed admin-only resource"
      : "Admin resource denied for non-admin user",
    response.status,
    { adminAccess: vulnerable, response: evidenceSummary(response) },
    input.target.attackMode === "sandbox" ? "sandbox" : "authorized_staging"
  );
}

async function probeSecurityHeaders(input: DynamicProbeInput): Promise<SafeRuntimeStepResult> {
  const insecurePath = resolveProbePath(input.target, input.fixtures, "securityHeaders");
  const securePath = resolveProbePath(input.target, input.fixtures, "securityHeadersSecure");
  const insecure = await input.client.request({ method: "GET", path: insecurePath, label: "headers_insecure" });
  const secure = await input.client.request({ method: "GET", path: securePath, label: "headers_secure" });
  const missingCsp = !insecure.headers["content-security-policy"];
  const missingHsts = !insecure.headers["strict-transport-security"];
  const vulnerable = missingCsp || missingHsts;
  return completed(
    input,
    vulnerable
      ? `Missing Content-Security-Policy and Strict-Transport-Security headers on ${insecurePath}`
      : "Security headers present on inspected response",
    insecure.status,
    {
      missingCsp,
      missingHsts,
      insecure: evidenceSummary(insecure),
      secureComparison: evidenceSummary(secure),
      securityHeadersPresent: !vulnerable,
    },
    input.target.attackMode === "sandbox" ? "sandbox" : "authorized_staging"
  );
}

async function probeInjectionSafe(input: DynamicProbeInput): Promise<SafeRuntimeStepResult> {
  const path = `${resolveProbePath(input.target, input.fixtures, "injectionEcho")}?q=${encodeURIComponent("' OR '1'='1")}`;
  const response = await input.client.request({ method: "GET", path, label: "injection_probe" });
  const reflected = response.bodyPreview.includes("' OR '1'='1") || /sql|syntax|error/i.test(response.bodyPreview);
  return completed(
    input,
    reflected
      ? "Safe injection probe payload reflected or echoed in response"
      : "Probe payload sanitized or rejected",
    response.status,
    { payloadReflected: reflected, response: evidenceSummary(response) },
    input.target.attackMode === "sandbox" ? "sandbox" : "authorized_staging"
  );
}

async function probeSsrfSafe(input: DynamicProbeInput): Promise<SafeRuntimeStepResult> {
  const path = `${resolveProbePath(input.target, input.fixtures, "ssrf")}?url=${encodeURIComponent("http://127.0.0.1:9/probe")}`;
  const response = await input.client.request({ method: "GET", path, label: "probe" });
  const internalFetch = /"fetched"\s*:\s*"http|"internalFetch"\s*:\s*true/i.test(response.bodyPreview);
  return completed(
    input,
    internalFetch
      ? "Server attempted internal/metadata fetch from user-supplied URL"
      : "Outbound request blocked; internal URL was not fetched",
    response.status,
    { internalFetch, response: evidenceSummary(response) },
    input.target.attackMode === "sandbox" ? "sandbox" : "authorized_staging"
  );
}

async function probeCorsMisconfiguration(input: DynamicProbeInput): Promise<SafeRuntimeStepResult> {
  const path = resolveProbePath(input.target, input.fixtures, "cors");
  const response = await input.client.request({
    method: "OPTIONS",
    path,
    headers: {
      origin: "https://evil.sequrai.test",
      "access-control-request-method": "GET",
    },
    label: "cors_preflight",
  });
  const allowOrigin = response.headers["access-control-allow-origin"] ?? "";
  const allowCredentials = response.headers["access-control-allow-credentials"] ?? "";
  const vulnerable =
    allowOrigin === "*" && allowCredentials === "true" ||
    (allowOrigin === "https://evil.sequrai.test" && allowCredentials === "true");
  return completed(
    input,
    vulnerable
      ? `CORS preflight returned permissive origin (${allowOrigin}) with credentials=${allowCredentials}`
      : "CORS restricted to safe origin policy",
    response.status,
    {
      corsWildcardWithCredentials: allowOrigin === "*" && allowCredentials === "true",
      corsRestricted: !vulnerable,
      response: evidenceSummary(response),
    },
    input.target.attackMode === "sandbox" ? "sandbox" : "authorized_staging"
  );
}

const PROBE_BY_ADAPTER: Record<
  string,
  (input: DynamicProbeInput) => Promise<SafeRuntimeStepResult>
> = {
  "unauthenticated-endpoint": probeUnauthenticatedEndpoint,
  "idor-cross-tenant": probeIdorCrossTenant,
  "rate-limit-brute-force": probeRateLimitBruteForce,
  "webhook-signature-bypass": probeWebhookSignatureBypass,
  "idempotency-replay": probeIdempotencyReplay,
  "mass-assignment-probe": probeMassAssignment,
  "privilege-escalation": probePrivilegeEscalation,
  "security-headers-probe": probeSecurityHeaders,
  "injection-probe-safe": probeInjectionSafe,
  "ssrf-probe-safe": probeSsrfSafe,
  "cors-misconfiguration": probeCorsMisconfiguration,
};

export async function executeDynamicAdapterProbe(
  input: DynamicProbeInput
): Promise<SafeRuntimeStepResult | null> {
  if (!DYNAMIC_CAPABLE_ADAPTER_IDS.has(input.adapterId)) return null;
  const probe = PROBE_BY_ADAPTER[input.adapterId];
  if (!probe) return null;
  return probe(input);
}

export function adapterSupportsDynamicExecution(adapterId: string): boolean {
  return DYNAMIC_CAPABLE_ADAPTER_IDS.has(adapterId);
}
