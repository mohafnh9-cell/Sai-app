import type { AttackEvidence } from "../contracts/attack-evidence";
import type { AttackFindingOutcome } from "../contracts/enums";
import type { AttackScenario } from "../contracts/attack-scenario";
import type { EvidenceCaptureBuffer } from "../evidence/capture-buffer";

export type AttackOutcomeEvaluation = {
  outcome: AttackFindingOutcome;
  severity: "info" | "low" | "medium" | "high" | "critical";
  impact: string;
  rootCause: string | null;
  rationale: string;
  exploitable: boolean;
};

export type MitigationTemplate = {
  adapterId: string;
  rootCause: string;
  recommendedProtection: string;
  implementationSteps: string[];
  likelyAffectedFiles: string[];
  implementationRisk: "low" | "medium" | "high";
  estimatedLoc: number;
  rollbackGuidance: string;
  residualRisk: string;
  exploitSignals: string[];
  protectionSignals: string[];
  defaultSeverity: "info" | "low" | "medium" | "high" | "critical";
};

export const MITIGATION_TEMPLATES: readonly MitigationTemplate[] = [
  {
    adapterId: "idor-cross-tenant",
    rootCause: "Resource access checks do not consistently bind records to the authenticated tenant.",
    recommendedProtection: "Enforce tenant-scoped authorization on every read and write path.",
    implementationSteps: [
      "Identify resource fetch/update handlers for the affected route.",
      "Require organizationId/projectId from session context, never from client input alone.",
      "Add regression tests for cross-tenant access attempts.",
    ],
    likelyAffectedFiles: ["server/**/route.ts", "server/**/repository.ts"],
    implementationRisk: "medium",
    estimatedLoc: 40,
    rollbackGuidance: "Revert authorization guard changes if legitimate shared resources break.",
    residualRisk: "Other routes with similar patterns may remain unprotected until scanned.",
    exploitSignals: ["cross-tenant", "tenant b", "other tenant", "foreign record"],
    protectionSignals: ["denied", "forbidden", "403", "not found for tenant"],
    defaultSeverity: "high",
  },
  {
    adapterId: "unauthenticated-endpoint",
    rootCause: "Route handler accepts requests without verifying authentication.",
    recommendedProtection: "Require authenticated session or signed token before handler logic.",
    implementationSteps: [
      "Add auth middleware or server-side session check to the route.",
      "Return 401 for missing/invalid credentials.",
      "Add test covering unauthenticated access attempt.",
    ],
    likelyAffectedFiles: ["app/api/**/route.ts", "middleware.ts"],
    implementationRisk: "low",
    estimatedLoc: 25,
    rollbackGuidance: "If public access is required, document exception and add rate limits.",
    residualRisk: "Other unauthenticated routes may still exist.",
    exploitSignals: ["unauthenticated", "accepted without auth", "missing auth", "200 without"],
    protectionSignals: ["401", "unauthorized", "redirected to login", "session required"],
    defaultSeverity: "high",
  },
  {
    adapterId: "webhook-signature-bypass",
    rootCause: "Webhook verification accepts missing or invalid signatures.",
    recommendedProtection: "Verify HMAC/signature with constant-time comparison before processing payload.",
    implementationSteps: [
      "Reject requests without signature header.",
      "Validate signature against shared secret.",
      "Add replay protection with timestamp tolerance if missing.",
    ],
    likelyAffectedFiles: ["app/api/webhooks/**/route.ts"],
    implementationRisk: "medium",
    estimatedLoc: 35,
    rollbackGuidance: "Keep feature flag for strict verification during rollout.",
    residualRisk: "Partner-specific webhook variants may need separate validators.",
    exploitSignals: ["signature bypass", "invalid signature accepted", "missing hmac"],
    protectionSignals: ["invalid signature rejected", "401", "403"],
    defaultSeverity: "high",
  },
  {
    adapterId: "idempotency-replay",
    rootCause: "Idempotency keys are not enforced across duplicate submissions.",
    recommendedProtection: "Persist idempotency outcomes and return the original result on replay.",
    implementationSteps: [
      "Require idempotency key for mutating operations.",
      "Store first result keyed by idempotency key.",
      "Return cached result on duplicate requests without reprocessing.",
    ],
    likelyAffectedFiles: ["server/**/route.ts", "server/**/idempotency.ts"],
    implementationRisk: "medium",
    estimatedLoc: 45,
    rollbackGuidance: "Disable strict idempotency middleware if legitimate retries fail.",
    residualRisk: "Clients generating weak keys may still collide.",
    exploitSignals: ["duplicate", "replay", "second side effect", "duplicate charge"],
    protectionSignals: ["idempotent", "original result", "duplicate prevented"],
    defaultSeverity: "high",
  },
  {
    adapterId: "double-credit-consumption",
    rootCause: "Credit or quota debits can be applied more than once for the same action.",
    recommendedProtection: "Make credit consumption atomic and idempotent per business action.",
    implementationSteps: [
      "Wrap debit in a transaction with unique action reference.",
      "Reject repeated debits for the same reference.",
      "Add audit log for quota changes.",
    ],
    likelyAffectedFiles: ["server/**/billing/**", "server/**/credits/**"],
    implementationRisk: "medium",
    estimatedLoc: 40,
    rollbackGuidance: "Revert debit guard if valid multi-step flows break.",
    residualRisk: "Race conditions under high concurrency may need locking.",
    exploitSignals: ["double", "credit", "quota", "consumption", "credits debited: 2"],
    protectionSignals: ["blocked by quota", "409", "single debit"],
    defaultSeverity: "high",
  },
  {
    adapterId: "workflow-bypass",
    rootCause: "Workflow transitions can skip required states such as payment confirmation.",
    recommendedProtection: "Validate workflow state server-side before allowing transitions.",
    implementationSteps: [
      "Map allowed transitions explicitly in server code.",
      "Reject requests that skip prerequisite states.",
      "Add regression tests for checkout and fulfillment flows.",
    ],
    likelyAffectedFiles: ["server/**/workflow/**", "app/api/**/checkout/**"],
    implementationRisk: "medium",
    estimatedLoc: 50,
    rollbackGuidance: "Feature-flag stricter transition checks during rollout.",
    residualRisk: "Parallel code paths may bypass the same guard.",
    exploitSignals: ["workflow bypass", "without payment", "payment confirmed: false"],
    protectionSignals: ["transition blocked", "422", "guard blocked"],
    defaultSeverity: "high",
  },
  {
    adapterId: "rag-prompt-injection",
    rootCause: "Retrieved content can carry attacker instructions into model context.",
    recommendedProtection: "Sanitize retrieved chunks and isolate instructions from document text.",
    implementationSteps: [
      "Strip or escape instruction-like patterns from retrieved text.",
      "Separate system policy from retrieved user content.",
      "Add tests with malicious mock documents.",
    ],
    likelyAffectedFiles: ["server/**/rag/**", "server/**/retrieval/**"],
    implementationRisk: "medium",
    estimatedLoc: 55,
    rollbackGuidance: "Relax sanitization only with monitoring for false positives.",
    residualRisk: "Novel injection phrasing may evade filters.",
    exploitSignals: ["prompt injection", "instruction injection", "rag prompt injection"],
    protectionSignals: ["sanitized", "instruction ignored", "injection blocked"],
    defaultSeverity: "high",
  },
  {
    adapterId: "unauthorized-tool-invocation",
    rootCause: "Agent runtime allows tool calls outside the approved profile.",
    recommendedProtection: "Enforce an allowlist of tools per agent profile before invocation.",
    implementationSteps: [
      "Validate tool name against profile allowlist.",
      "Reject disallowed function calls before execution.",
      "Log blocked tool attempts for review.",
    ],
    likelyAffectedFiles: ["server/**/agents/**", "server/**/tools/**"],
    implementationRisk: "medium",
    estimatedLoc: 35,
    rollbackGuidance: "Expand allowlist temporarily if legitimate tools are blocked.",
    residualRisk: "Dynamic tool registration may bypass static allowlists.",
    exploitSignals: ["unauthorized tool", "function call", "outside profile"],
    protectionSignals: ["tool blocked", "403", "agent policy"],
    defaultSeverity: "high",
  },
  {
    adapterId: "memory-isolation",
    rootCause: "Memory retrieval is not scoped to the authenticated user.",
    recommendedProtection: "Bind memory queries to user or tenant identity on every retrieval.",
    implementationSteps: [
      "Include userId/tenantId in memory lookup keys.",
      "Reject cross-user memory identifiers.",
      "Add isolation tests for memory stores.",
    ],
    likelyAffectedFiles: ["server/**/memory/**", "server/**/vector/**"],
    implementationRisk: "medium",
    estimatedLoc: 40,
    rollbackGuidance: "Revert scoping if shared team memories are required by product.",
    residualRisk: "Shared memory namespaces need explicit policy.",
    exploitSignals: ["cross-user memory", "memory isolation", "another user's context"],
    protectionSignals: ["scoped to authenticated user", "memory isolation", "isolation enforced"],
    defaultSeverity: "high",
  },
  {
    adapterId: "rag-poisoning",
    rootCause: "Untrusted documents can influence retrieval without validation.",
    recommendedProtection: "Quarantine and rank-limit untrusted corpus entries before retrieval.",
    implementationSteps: [
      "Validate or scan uploaded corpus documents.",
      "Deprioritize or block poisoned sources.",
      "Monitor retrieval rankings for anomalies.",
    ],
    likelyAffectedFiles: ["server/**/rag/**", "server/**/ingestion/**"],
    implementationRisk: "medium",
    estimatedLoc: 45,
    rollbackGuidance: "Adjust quarantine thresholds if benign docs are filtered.",
    residualRisk: "Sophisticated poisoning may still affect ranking.",
    exploitSignals: ["rag poisoning", "poisoned document", "corpus poison"],
    protectionSignals: ["quarantined", "corpus sanitized", "retrieval unaffected"],
    defaultSeverity: "medium",
  },
] as const;

const DEFAULT_TEMPLATE: MitigationTemplate = {
  adapterId: "default",
  rootCause: "Observed behavior suggests a gap between expected and actual protection.",
  recommendedProtection: "Add explicit authorization and validation at the affected boundary.",
  implementationSteps: [
    "Review the affected workflow boundary.",
    "Add server-side validation and authorization checks.",
    "Add regression test reproducing the attack scenario safely.",
  ],
  likelyAffectedFiles: ["server/**"],
  implementationRisk: "medium",
  estimatedLoc: 30,
  rollbackGuidance: "Revert the protection change if legitimate workflows fail.",
  residualRisk: "Similar patterns elsewhere may remain unreviewed.",
  exploitSignals: ["vulnerable", "exploitable", "bypass", "unexpected access"],
  protectionSignals: ["blocked", "denied", "forbidden", "not exploitable"],
  defaultSeverity: "medium",
};

export function getMitigationTemplate(adapterId: string): MitigationTemplate {
  return MITIGATION_TEMPLATES.find((template) => template.adapterId === adapterId) ?? DEFAULT_TEMPLATE;
}

function haystackFromEvidence(
  evidence: Pick<AttackEvidence, "expectedBehavior" | "observedBehavior" | "sideEffects">,
  buffer?: EvidenceCaptureBuffer
): string {
  const parts = [
    evidence.expectedBehavior,
    evidence.observedBehavior,
    JSON.stringify(evidence.sideEffects),
  ];
  if (buffer) {
    for (const step of buffer.steps) {
      parts.push(step.runtimeResult.observedBehavior);
      parts.push(JSON.stringify(step.runtimeResult.sideEffects ?? {}));
    }
  }
  return parts.join(" ").toLowerCase();
}

function countSignals(haystack: string, signals: string[]): number {
  return signals.reduce((count, signal) => (haystack.includes(signal.toLowerCase()) ? count + 1 : count), 0);
}

export function evaluateAttackOutcome(input: {
  evidence: Pick<
    AttackEvidence,
    "confidence" | "expectedBehavior" | "observedBehavior" | "sideEffects" | "statusCode"
  >;
  scenario: Pick<AttackScenario, "adapterId" | "title" | "category">;
  buffer?: EvidenceCaptureBuffer;
  executionBlocked?: boolean;
}): AttackOutcomeEvaluation {
  const template = getMitigationTemplate(input.scenario.adapterId);
  const haystack = haystackFromEvidence(input.evidence, input.buffer);
  const exploitHits = countSignals(haystack, template.exploitSignals);
  const protectionHits = countSignals(haystack, template.protectionSignals);

  if (input.executionBlocked || protectionHits > exploitHits) {
    return {
      outcome: "not_exploitable",
      severity: "info",
      impact: "Safe runtime or application protections prevented exploitation in this run.",
      rootCause: null,
      rationale: "Protection signals outweighed exploit indicators or runtime blocked the attack.",
      exploitable: false,
    };
  }

  if (exploitHits > 0 && input.evidence.confidence >= 0.55) {
    return {
      outcome: "confirmed",
      severity: template.defaultSeverity,
      impact: `Attack scenario "${input.scenario.title}" appears exploitable under ${input.scenario.category} assumptions.`,
      rootCause: template.rootCause,
      rationale: `Matched ${exploitHits} exploit signal(s) with evidence confidence ${input.evidence.confidence}.`,
      exploitable: true,
    };
  }

  if (input.evidence.confidence >= 0.75 && input.evidence.statusCode != null && input.evidence.statusCode < 400) {
    return {
      outcome: "inconclusive",
      severity: "medium",
      impact: "Attack completed without clear exploit or protection signals.",
      rootCause: null,
      rationale: "Successful response without strong exploit/protection indicators.",
      exploitable: false,
    };
  }

  return {
    outcome: "not_exploitable",
    severity: "info",
    impact: "No exploitable behavior was confirmed from collected evidence.",
    rootCause: null,
    rationale: "Insufficient exploit signals in observed behavior.",
    exploitable: false,
  };
}
