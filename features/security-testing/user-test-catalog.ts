import type { SecurityTestOption } from "./types";

/** Plain-language labels — no internal engine jargon. */
export const USER_FRIENDLY_TEST_COPY: Record<
  string,
  { title: string; description: string; categoryLabel: string }
> = {
  "idor-cross-tenant": {
    title: "Can someone access another user's data?",
    description: "Checks whether one account can read or change another account's records.",
    categoryLabel: "Data access",
  },
  "unauthenticated-endpoint": {
    title: "Can protected pages be opened without logging in?",
    description: "Tests whether sensitive routes accept requests without authentication.",
    categoryLabel: "Login protection",
  },
  "webhook-signature-bypass": {
    title: "Can fake webhook events be accepted?",
    description: "Simulates webhook calls with missing or invalid signatures.",
    categoryLabel: "Webhook security",
  },
  "idempotency-replay": {
    title: "Can the same action charge or mutate data twice?",
    description: "Sends the same request twice to detect duplicate side effects.",
    categoryLabel: "Payment safety",
  },
  "double-credit-consumption": {
    title: "Can credits or quotas be spent more than once?",
    description: "Attempts repeated consumption of the same balance.",
    categoryLabel: "Billing safety",
  },
  "workflow-bypass": {
    title: "Can a checkout or approval step be skipped?",
    description: "Tries to jump past required workflow states.",
    categoryLabel: "Business rules",
  },
  "rag-prompt-injection": {
    title: "Can uploaded content hijack AI answers?",
    description: "Uses safe mock documents to test retrieval-time manipulation.",
    categoryLabel: "AI safety",
  },
  "unauthorized-tool-invocation": {
    title: "Can the AI call tools it should not use?",
    description: "Simulates tool calls outside the allowed profile.",
    categoryLabel: "AI safety",
  },
  "memory-isolation": {
    title: "Can one user read another user's AI memory?",
    description: "Checks whether memory retrieval crosses user boundaries.",
    categoryLabel: "AI privacy",
  },
  "rag-poisoning": {
    title: "Can poisoned documents change AI behavior?",
    description: "Observes how the app handles untrusted retrieved content.",
    categoryLabel: "AI safety",
  },
};

export const DEFAULT_SECURITY_TEST_IDS = [
  "idor-cross-tenant",
  "unauthenticated-endpoint",
  "workflow-bypass",
  "webhook-signature-bypass",
  "double-credit-consumption",
  "idempotency-replay",
] as const;

export function buildFallbackSecurityTestOptions(): SecurityTestOption[] {
  return DEFAULT_SECURITY_TEST_IDS.map((id, index) => {
    const friendly = USER_FRIENDLY_TEST_COPY[id];
    return {
      id,
      title: friendly.title,
      description: friendly.description,
      severity: index < 2 ? "high" : "medium",
      categoryLabel: friendly.categoryLabel,
      recommended: index < 4,
    };
  });
}
