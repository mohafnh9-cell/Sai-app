import type { AttackAdapterDefinition } from "@/server/attack-simulation/planner/adapter-catalog";
import type { RepositoryModel } from "./schema";

export type AttackPreconditionResult = { satisfied: true } | { satisfied: false; reason: string };

export function validateAdapterPreconditions(
  adapter: Pick<AttackAdapterDefinition, "id" | "category">,
  model: RepositoryModel
): AttackPreconditionResult {
  switch (adapter.id) {
    case "unauthenticated-endpoint":
      if (!model.capabilities.hasApiSurface) {
        return { satisfied: false, reason: "No API routes or handlers exist in this repository." };
      }
      if (model.capabilities.hasPublicPagesOnly && !model.capabilities.hasProtectedRoutes) {
        return { satisfied: false, reason: "Public website without protected endpoints." };
      }
      return { satisfied: true };

    case "idor-cross-tenant":
      if (!model.capabilities.hasDatabase && !model.capabilities.hasApiSurface) {
        return { satisfied: false, reason: "No multi-tenant data surface detected." };
      }
      return { satisfied: true };

    case "webhook-signature-bypass":
      if (!model.capabilities.hasWebhookHandlers && !model.paths.some((p) => /webhook/i.test(p))) {
        return { satisfied: false, reason: "No webhook handlers found." };
      }
      return { satisfied: true };

    case "workflow-bypass":
    case "idempotency-replay":
    case "double-credit-consumption":
      if (!model.capabilities.hasApiSurface) {
        return { satisfied: false, reason: "No mutating API surface for business-logic tests." };
      }
      return { satisfied: true };

    case "rag-prompt-injection":
    case "rag-poisoning":
    case "unauthorized-tool-invocation":
    case "memory-isolation":
      if (!model.capabilities.hasLlmIntegration) {
        return { satisfied: false, reason: "No LLM/RAG integration detected in repository." };
      }
      return { satisfied: true };

    default:
      return { satisfied: true };
  }
}

export function isAdapterCompatibleWithFramework(
  adapter: Pick<AttackAdapterDefinition, "id">,
  model: RepositoryModel
): AttackPreconditionResult {
  if (adapter.id === "unauthenticated-endpoint") {
    if (model.framework === "static") {
      return { satisfied: false, reason: "Static site — endpoint auth test not applicable." };
    }
    if (model.framework === "react_spa" || model.framework === "vite" || model.framework === "vue") {
      if (!model.capabilities.hasExpressRoutes && !model.capabilities.hasAppApi && !model.capabilities.hasPagesApi) {
        return { satisfied: false, reason: "SPA without backend routes — use API-specific tests instead." };
      }
    }
  }
  return { satisfied: true };
}
