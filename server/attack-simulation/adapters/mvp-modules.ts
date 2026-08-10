import { createMvpAttackAdapter, observeFromExecute, requestStep, verifyFromExecute } from "./shared";
import type { MvpAttackAdapterConfig } from "./types";

const MVP_ATTACK_ADAPTER_CONFIGS: readonly MvpAttackAdapterConfig[] = [
  {
    id: "idor-cross-tenant",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Cross-tenant record returned when tenant B accessed tenant A project resource",
            statusCode: 200,
            sideEffects: { crossTenantAccess: true, foreignRecord: true },
          },
          {
            observed: "Cross-tenant access denied with forbidden response for foreign tenant record",
            statusCode: 403,
            sideEffects: { crossTenantAccess: false },
          }
        ),
      observe_response: (input, outcome) =>
        observeFromExecute(
          input,
          outcome,
          "Observed foreign tenant payload in response body",
          "Observed forbidden response; tenant boundary enforced"
        ),
      verify_side_effects: (input, outcome) =>
        verifyFromExecute(
          input,
          outcome,
          "Side effect confirms cross-tenant read succeeded",
          "No cross-tenant side effects detected"
        ),
    },
  },
  {
    id: "unauthenticated-endpoint",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Route accepted request without authentication and returned 200",
            statusCode: 200,
            sideEffects: { unauthenticated: true },
          },
          {
            observed: "Missing auth rejected with unauthorized response",
            statusCode: 401,
            sideEffects: { sessionRequired: true },
          }
        ),
      observe_response: (input, outcome) =>
        observeFromExecute(
          input,
          outcome,
          "Response delivered to unauthenticated caller",
          "Unauthorized response returned; session required"
        ),
    },
  },
  {
    id: "webhook-signature-bypass",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Webhook accepted payload with invalid signature (signature bypass)",
            statusCode: 200,
            sideEffects: { invalidSignatureAccepted: true },
          },
          {
            observed: "Invalid signature rejected before webhook processing",
            statusCode: 401,
            sideEffects: { invalidSignatureRejected: true },
          }
        ),
    },
  },
  {
    id: "idempotency-replay",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Duplicate idempotency replay created a second side effect",
            statusCode: 200,
            sideEffects: { duplicateCharge: true, replay: true },
          },
          {
            observed: "Replay returned original result without duplicate side effect",
            statusCode: 200,
            sideEffects: { idempotent: true },
          }
        ),
      verify_side_effects: (input, outcome) =>
        verifyFromExecute(
          input,
          outcome,
          "Duplicate side effect observed after replay",
          "Idempotency key prevented duplicate processing"
        ),
    },
  },
  {
    id: "double-credit-consumption",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Repeated credit consumption attempt succeeded twice (double credit consumption)",
            statusCode: 200,
            sideEffects: { creditsDebited: 2 },
          },
          {
            observed: "Second credit consumption blocked by quota guard",
            statusCode: 409,
            sideEffects: { creditsDebited: 1 },
          }
        ),
    },
  },
  {
    id: "workflow-bypass",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Workflow bypass allowed checkout completion without payment confirmation",
            statusCode: 200,
            sideEffects: { workflowBypass: true, paymentConfirmed: false },
          },
          {
            observed: "Workflow guard blocked transition without required payment state",
            statusCode: 422,
            sideEffects: { workflowBypass: false },
          }
        ),
    },
  },
  {
    id: "rag-prompt-injection",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Retrieved mock document executed attacker instruction (rag prompt injection)",
            statusCode: 200,
            sideEffects: { instructionInjection: true },
          },
          {
            observed: "Retrieved content sanitized; injected instruction ignored",
            statusCode: 200,
            sideEffects: { instructionInjection: false },
          }
        ),
    },
  },
  {
    id: "unauthorized-tool-invocation",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Agent invoked disallowed tool function call outside profile",
            statusCode: 200,
            sideEffects: { unauthorizedToolCall: true },
          },
          {
            observed: "Tool call blocked by agent policy",
            statusCode: 403,
            sideEffects: { toolBlocked: true },
          }
        ),
    },
  },
  {
    id: "memory-isolation",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Cross-user memory retrieval returned another user's context",
            statusCode: 200,
            sideEffects: { crossUserMemory: true, memoryIsolationBroken: true },
          },
          {
            observed: "Memory retrieval scoped to authenticated user only",
            statusCode: 200,
            sideEffects: { memoryIsolation: true },
          }
        ),
    },
  },
  {
    id: "rag-poisoning",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Poisoned mock corpus document influenced retrieval ranking (rag poisoning)",
            statusCode: 200,
            sideEffects: { poisonedDocumentRanked: true },
          },
          {
            observed: "Poisoned document quarantined; retrieval unaffected",
            statusCode: 200,
            sideEffects: { corpusSanitized: true },
          }
        ),
    },
  },
  {
    id: "rate-limit-brute-force",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "100 rapid requests to authentication endpoint — all 100 accepted (no rate limiting)",
            statusCode: 200,
            sideEffects: { requestsSent: 100, requestsAccepted: 100, requestsBlocked: 0 },
          },
          {
            observed: "Rate limit enforced after threshold — requests blocked with 429",
            statusCode: 429,
            sideEffects: { requestsSent: 100, requestsAccepted: 10, requestsBlocked: 90, retryAfter: true },
          }
        ),
      observe_response: (input, outcome) =>
        observeFromExecute(
          input,
          outcome,
          "No Retry-After header; brute-force requests not throttled",
          "Retry-After returned; throttling active"
        ),
    },
  },
  {
    id: "mass-assignment-probe",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "POST accepted privileged field role=admin in request body (mass assignment)",
            statusCode: 200,
            sideEffects: { privilegedFieldAccepted: true, field: "role" },
          },
          {
            observed: "Privileged fields stripped or rejected by server validation",
            statusCode: 400,
            sideEffects: { privilegedFieldAccepted: false },
          }
        ),
    },
  },
  {
    id: "privilege-escalation",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Standard user accessed admin-only resource (privilege escalation)",
            statusCode: 200,
            sideEffects: { adminAccess: true, role: "user" },
          },
          {
            observed: "Admin resource denied for non-admin user",
            statusCode: 403,
            sideEffects: { adminAccess: false },
          }
        ),
    },
  },
  {
    id: "security-headers-probe",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Response missing Content-Security-Policy and Strict-Transport-Security headers",
            statusCode: 200,
            sideEffects: { missingCsp: true, missingHsts: true },
          },
          {
            observed: "Security headers present on response",
            statusCode: 200,
            sideEffects: { securityHeadersPresent: true },
          }
        ),
    },
  },
  {
    id: "injection-probe-safe",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Safe SQL/XSS probe payload reflected or executed in response (injection)",
            statusCode: 200,
            sideEffects: { payloadReflected: true, probe: "' OR '1'='1" },
          },
          {
            observed: "Probe payload sanitized or rejected",
            statusCode: 400,
            sideEffects: { payloadReflected: false },
          }
        ),
    },
  },
  {
    id: "ssrf-probe-safe",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "Server fetched internal/metadata URL from user-supplied parameter (SSRF)",
            statusCode: 200,
            sideEffects: { internalFetch: true, target: "169.254.169.254" },
          },
          {
            observed: "Internal/metadata URLs blocked by outbound allowlist",
            statusCode: 400,
            sideEffects: { internalFetch: false },
          }
        ),
    },
  },
  {
    id: "cors-misconfiguration",
    handlers: {
      execute_request: (input, outcome) =>
        requestStep(
          input,
          outcome,
          {
            observed: "CORS preflight returned Access-Control-Allow-Origin: * with credentials",
            statusCode: 204,
            sideEffects: { corsWildcardWithCredentials: true },
          },
          {
            observed: "CORS restricted to explicit allowlist without credential wildcard",
            statusCode: 204,
            sideEffects: { corsRestricted: true },
          }
        ),
    },
  },
];

export const MVP_ATTACK_ADAPTER_MODULES = MVP_ATTACK_ADAPTER_CONFIGS.map(createMvpAttackAdapter);

export { MVP_ATTACK_ADAPTER_CONFIGS };
