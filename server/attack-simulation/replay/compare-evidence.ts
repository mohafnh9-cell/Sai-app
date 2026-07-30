import type { AttackEvidence } from "../contracts/attack-evidence";
import type { ProtectionVerificationOutcome } from "../contracts/enums";
import type { AttackScenario } from "../contracts/attack-scenario";
import { getMitigationTemplate } from "../mitigation/evaluate-outcome";

export type ProtectionComparisonResult = {
  outcome: ProtectionVerificationOutcome;
  summary: string;
  comparison: {
    originalExploitSignals: number;
    replayExploitSignals: number;
    replayProtectionSignals: number;
    originalStatusCode: number | null;
    replayStatusCode: number | null;
    observedBehaviorChanged: boolean;
    originalConfidence: number;
    replayConfidence: number;
  };
};

function signalHaystack(
  evidence: Pick<AttackEvidence, "expectedBehavior" | "observedBehavior" | "sideEffects">
): string {
  return [
    evidence.expectedBehavior,
    evidence.observedBehavior,
    JSON.stringify(evidence.sideEffects),
  ]
    .join(" ")
    .toLowerCase();
}

function countSignals(haystack: string, signals: string[]): number {
  return signals.reduce(
    (count, signal) => (haystack.includes(signal.toLowerCase()) ? count + 1 : count),
    0
  );
}

export function compareProtectionEvidence(input: {
  originalEvidence: AttackEvidence;
  replayEvidence: AttackEvidence;
  scenario: Pick<AttackScenario, "adapterId">;
  originalFindingConfirmed?: boolean;
}): ProtectionComparisonResult {
  const template = getMitigationTemplate(input.scenario.adapterId);
  const originalHaystack = signalHaystack(input.originalEvidence);
  const replayHaystack = signalHaystack(input.replayEvidence);

  const originalExploitSignals = countSignals(originalHaystack, template.exploitSignals);
  const replayExploitSignals = countSignals(replayHaystack, template.exploitSignals);
  const replayProtectionSignals = countSignals(replayHaystack, template.protectionSignals);

  const observedBehaviorChanged =
    input.originalEvidence.observedBehavior.trim() !==
    input.replayEvidence.observedBehavior.trim();

  const comparison = {
    originalExploitSignals,
    replayExploitSignals,
    replayProtectionSignals,
    originalStatusCode: input.originalEvidence.statusCode,
    replayStatusCode: input.replayEvidence.statusCode,
    observedBehaviorChanged,
    originalConfidence: input.originalEvidence.confidence,
    replayConfidence: input.replayEvidence.confidence,
  };

  const originalWasExploitable =
    input.originalFindingConfirmed ??
    (originalExploitSignals > 0 || input.originalEvidence.confidence >= 0.6);

  if (!originalWasExploitable) {
    return {
      outcome: "inconclusive",
      summary: "Original attack was not confirmed exploitable; replay comparison is inconclusive.",
      comparison,
    };
  }

  if (replayProtectionSignals > replayExploitSignals) {
    return {
      outcome: "protected",
      summary: "Replay run shows protection signals outweigh exploit indicators.",
      comparison,
    };
  }

  if (
    replayExploitSignals > 0 &&
    (input.replayEvidence.statusCode ?? 500) < 400 &&
    replayProtectionSignals <= replayExploitSignals
  ) {
    return {
      outcome: "still_vulnerable",
      summary: "Replay run still exhibits exploit indicators against the same scenario.",
      comparison,
    };
  }

  if (observedBehaviorChanged && replayProtectionSignals > 0) {
    return {
      outcome: "protected",
      summary: "Observed behavior changed and replay includes protection indicators.",
      comparison,
    };
  }

  return {
    outcome: "inconclusive",
    summary: "Replay evidence did not clearly prove protection or continued vulnerability.",
    comparison,
  };
}
