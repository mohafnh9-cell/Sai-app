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
];

export const MVP_ATTACK_ADAPTER_MODULES = MVP_ATTACK_ADAPTER_CONFIGS.map(createMvpAttackAdapter);

export { MVP_ATTACK_ADAPTER_CONFIGS };
