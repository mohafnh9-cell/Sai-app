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
