import type { AttackHypothesis } from "../contracts/attack-hypothesis";
import type { AttackRuntimeMode } from "../contracts/enums";
import type { CreateAttackScenarioInput } from "../contracts/attack-scenario";
import {
  isAdapterAllowedForRuntime,
  resolveAdapterForHypothesis,
  type AttackAdapterDefinition,
} from "./adapter-catalog";

export type PlannedAttackScenario = {
  hypothesis: AttackHypothesis;
  adapter: AttackAdapterDefinition;
  scenarioInput: CreateAttackScenarioInput;
};

export type PlanScenariosResult = {
  planned: PlannedAttackScenario[];
  skipped: Array<{ hypothesisId: string; reason: string }>;
};

export function planScenariosFromHypotheses(input: {
  campaignId: string;
  organizationId: string;
  projectId: string;
  runtimeMode: AttackRuntimeMode;
  hypotheses: AttackHypothesis[];
}): PlanScenariosResult {
  const planned: PlannedAttackScenario[] = [];
  const skipped: Array<{ hypothesisId: string; reason: string }> = [];

  input.hypotheses.forEach((hypothesis, index) => {
    const adapter = resolveAdapterForHypothesis({
      category: hypothesis.category,
      title: hypothesis.title,
      description: hypothesis.description,
      adapterHint: hypothesis.adapterHint,
    });

    if (!isAdapterAllowedForRuntime(adapter, input.runtimeMode)) {
      skipped.push({
        hypothesisId: hypothesis.id,
        reason: `Adapter ${adapter.id} is not allowed for runtime ${input.runtimeMode}`,
      });
      return;
    }

    planned.push({
      hypothesis,
      adapter,
      scenarioInput: {
        campaignId: input.campaignId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        hypothesisId: hypothesis.id,
        adapterId: adapter.id,
        category: adapter.category,
        title: hypothesis.title,
        description: hypothesis.description,
        sortOrder: index,
        redTeamSource: hypothesis.source,
        metadata: {
          severity: hypothesis.severity,
          confidence: hypothesis.confidence,
          protectedAsset: hypothesis.protectedAsset ?? null,
          attackerProfile: hypothesis.attackerProfile ?? {},
          plannerVersion: "ase-slice-2",
          ...(hypothesis.metadata ?? {}),
        },
      },
    });
  });

  return { planned, skipped };
}
