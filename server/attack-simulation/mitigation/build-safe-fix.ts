import type { AttackFinding } from "../contracts/attack-finding";
import type { AttackMitigation } from "../contracts/attack-mitigation";
import type { CreateAttackSafeFixInput } from "../contracts/attack-safe-fix";
import type { AttackScenario } from "../contracts/attack-scenario";

export function buildAttackSafeFixCursorPrompt(input: {
  finding: Pick<AttackFinding, "title" | "description" | "impact" | "rootCause">;
  mitigation: Pick<
    AttackMitigation,
    | "plainLanguageExplanation"
    | "recommendedProtection"
    | "implementationSteps"
    | "likelyAffectedFiles"
    | "rollbackGuidance"
    | "residualRisk"
  >;
  scenario: Pick<AttackScenario, "adapterId" | "title">;
  attackFindingId: string;
}): string {
  const sections = [
    "# SequrAI Attack Simulation Safe Fix",
    "",
    `Attack finding ID: ${input.attackFindingId}`,
    `Scenario: ${input.scenario.title} (${input.scenario.adapterId})`,
    "",
    "## Problem",
    input.finding.description,
    "",
    "## Impact",
    input.finding.impact,
    "",
    "## Root cause",
    input.finding.rootCause ?? input.mitigation.plainLanguageExplanation,
    "",
    "## Recommended protection",
    input.mitigation.recommendedProtection,
    "",
    "## Implementation steps",
    ...input.mitigation.implementationSteps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Likely affected files",
    ...input.mitigation.likelyAffectedFiles.map((file) => `- ${file}`),
    "",
    "## Verification",
    "- Re-run the attack simulation scenario after applying the fix.",
    "- Confirm the attack is no longer exploitable.",
    "",
    "## Rollback",
    input.mitigation.rollbackGuidance,
    "",
    "## Residual risk",
    input.mitigation.residualRisk,
  ];

  return sections.join("\n");
}

export function buildAttackSafeFixInput(input: {
  finding: Pick<
    AttackFinding,
    "id" | "executionId" | "campaignId" | "organizationId" | "projectId" | "title" | "description" | "impact" | "rootCause"
  >;
  mitigation: Pick<
    AttackMitigation,
    | "id"
    | "implementationRisk"
    | "safeFixConfidence"
    | "estimatedLoc"
    | "plainLanguageExplanation"
    | "recommendedProtection"
    | "implementationSteps"
    | "likelyAffectedFiles"
    | "rollbackGuidance"
    | "residualRisk"
  >;
  scenario: Pick<AttackScenario, "adapterId" | "title">;
}): CreateAttackSafeFixInput {
  const cursorPrompt = buildAttackSafeFixCursorPrompt({
    finding: input.finding,
    mitigation: input.mitigation,
    scenario: input.scenario,
    attackFindingId: input.finding.id,
  });

  return {
    mitigationId: input.mitigation.id,
    findingId: input.finding.id,
    executionId: input.finding.executionId,
    campaignId: input.finding.campaignId,
    organizationId: input.finding.organizationId,
    projectId: input.finding.projectId,
    status: "ready",
    cursorPrompt,
    patchProposal: null,
    pullRequestProposal: null,
    requiredTests: [
      "Add regression test reproducing the attack scenario safely.",
      "Verify authorized users retain expected access.",
    ],
    rollbackPlan: input.mitigation.rollbackGuidance,
    affectedFiles: [...input.mitigation.likelyAffectedFiles],
    confidence: input.mitigation.safeFixConfidence,
    implementationRisk: input.mitigation.implementationRisk,
    estimatedLoc: input.mitigation.estimatedLoc,
    metadata: {
      attackFindingId: input.finding.id,
      adapterId: input.scenario.adapterId,
      source: "attack_simulation_engine",
    },
  };
}
