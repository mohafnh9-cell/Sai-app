import type { AttackRuntimeMode } from "../contracts/enums";

export type AttackAdapterDefinition = {
  id: string;
  category: string;
  title: string;
  description: string;
  allowedRuntimeModes: readonly AttackRuntimeMode[];
  hypothesisCategories: readonly string[];
  hypothesisKeywords: readonly string[];
  requiredArchitecture?: readonly string[];
};

/** MVP safe adapters — metadata in catalog; execution modules in `adapters/`. */
export const ATTACK_ADAPTER_CATALOG: readonly AttackAdapterDefinition[] = [
  {
    id: "idor-cross-tenant",
    category: "authorization",
    title: "Cross-tenant IDOR",
    description: "Simulates cross-tenant resource access using mock identities.",
    allowedRuntimeModes: ["static", "mock", "sandbox"],
    hypothesisCategories: ["authorization", "idor", "cross_tenant"],
    hypothesisKeywords: ["idor", "cross-tenant", "cross tenant", "tenant"],
  },
  {
    id: "unauthenticated-endpoint",
    category: "authentication",
    title: "Unauthenticated endpoint",
    description: "Checks whether a route accepts unauthenticated access in a safe mock.",
    allowedRuntimeModes: ["static", "mock", "sandbox"],
    hypothesisCategories: ["authentication", "auth", "unauthenticated"],
    hypothesisKeywords: ["unauthenticated", "missing auth", "no auth"],
    requiredArchitecture: ["api_surface"],
  },
  {
    id: "webhook-signature-bypass",
    category: "web",
    title: "Webhook signature bypass",
    description: "Tests webhook verification with invalid or missing signatures (mock).",
    allowedRuntimeModes: ["mock", "sandbox"],
    hypothesisCategories: ["webhook", "web", "signature"],
    hypothesisKeywords: ["webhook", "signature", "hmac"],
  },
  {
    id: "idempotency-replay",
    category: "reliability",
    title: "Idempotency replay",
    description: "Replays idempotent operations to detect duplicate side effects.",
    allowedRuntimeModes: ["mock", "sandbox"],
    hypothesisCategories: ["idempotency", "reliability", "replay"],
    hypothesisKeywords: ["idempotency", "duplicate", "replay"],
  },
  {
    id: "double-credit-consumption",
    category: "business_logic",
    title: "Double credit consumption",
    description: "Simulates repeated credit or quota consumption attempts.",
    allowedRuntimeModes: ["mock", "sandbox"],
    hypothesisCategories: ["business_logic", "payments", "credits"],
    hypothesisKeywords: ["double", "credit", "quota", "consumption"],
  },
  {
    id: "workflow-bypass",
    category: "business_logic",
    title: "Workflow bypass",
    description: "Attempts to skip required workflow states using safe fixtures.",
    allowedRuntimeModes: ["mock", "sandbox"],
    hypothesisCategories: ["business_logic", "workflow"],
    hypothesisKeywords: ["workflow", "bypass", "state machine"],
  },
  {
    id: "rag-prompt-injection",
    category: "llm",
    title: "RAG indirect prompt injection",
    description: "Uses mock documents to test retrieval-time instruction injection.",
    allowedRuntimeModes: ["mock", "sandbox"],
    hypothesisCategories: ["llm", "rag", "prompt_injection"],
    hypothesisKeywords: ["rag", "prompt injection", "indirect"],
  },
  {
    id: "unauthorized-tool-invocation",
    category: "llm",
    title: "Unauthorized tool invocation",
    description: "Simulates tool calls outside the allowed agent profile.",
    allowedRuntimeModes: ["mock", "sandbox"],
    hypothesisCategories: ["llm", "tools", "agent"],
    hypothesisKeywords: ["tool", "function call", "agent"],
  },
  {
    id: "memory-isolation",
    category: "llm",
    title: "Cross-user memory isolation",
    description: "Checks whether memory retrieval crosses user boundaries in mock stores.",
    allowedRuntimeModes: ["mock", "sandbox"],
    hypothesisCategories: ["llm", "memory", "isolation"],
    hypothesisKeywords: ["memory", "isolation", "cross-user"],
  },
  {
    id: "rag-poisoning",
    category: "llm",
    title: "Simulated RAG poisoning",
    description: "Injects benign poisoned mock documents to observe retrieval behavior.",
    allowedRuntimeModes: ["mock", "sandbox"],
    hypothesisCategories: ["llm", "rag", "poisoning"],
    hypothesisKeywords: ["poison", "rag", "corpus"],
  },
] as const;

export function getAttackAdapterById(adapterId: string): AttackAdapterDefinition | undefined {
  return ATTACK_ADAPTER_CATALOG.find((adapter) => adapter.id === adapterId);
}

export function resolveAdapterForHypothesis(input: {
  category: string;
  title: string;
  description: string;
  adapterHint?: string;
}): AttackAdapterDefinition {
  if (input.adapterHint) {
    const hinted = getAttackAdapterById(input.adapterHint);
    if (hinted) return hinted;
  }

  const haystack = `${input.category} ${input.title} ${input.description}`.toLowerCase();
  const category = input.category.toLowerCase();

  let best: AttackAdapterDefinition = ATTACK_ADAPTER_CATALOG[0];
  let bestScore = -1;

  for (const adapter of ATTACK_ADAPTER_CATALOG) {
    let score = 0;
    for (const keyword of adapter.hypothesisKeywords) {
      if (haystack.includes(keyword)) score += 2;
    }
    for (const value of adapter.hypothesisCategories) {
      if (category === value || category.includes(value)) score += 1;
    }
    if (score > bestScore) {
      best = adapter;
      bestScore = score;
    }
  }

  return best;
}

export function isAdapterAllowedForRuntime(
  adapter: AttackAdapterDefinition,
  runtimeMode: AttackRuntimeMode
): boolean {
  return adapter.allowedRuntimeModes.includes(runtimeMode);
}
