import { stableAiId } from "../model/stable-id";
import { planAiExecutions } from "../runtime/execution-planner";
import {
  DEFAULT_AI_RUNTIME_BUDGET,
  DEFAULT_AI_RUNTIME_LIMITS,
  DEFAULT_AI_RUNTIME_PROFILE,
} from "../runtime/runtime.config";
import type { AIFinding, AIFindingBuildInput, AIFindingCollection } from "./finding.types";
import { ATTACK_TO_FINDING_CATEGORY } from "./finding.types";
import {
  buildAttackPreconditions,
  findingConfidenceFromExecution,
  findingSeverity,
  mapAttackerCapability,
} from "./attack-preconditions";
import { buildFixContext } from "./finding-fix-context";
import { buildReplayPlan } from "./finding-replay";
import { correlateFindings, mapRuntimeToFindingEvidence } from "./finding-correlation";
import { validateFindingCollection } from "./finding-validator";

function isValidatedRuntimeEvidence(
  execution: import("../runtime/runtime.types").AIExecutionResult
): boolean {
  if (execution.status !== "completed") return false;
  if (!execution.violatedInvariantId) return false;
  return execution.evidence.some(
    (e) => e.source === "runtime_simulation" || e.source === "synthetic_llm"
  );
}

function discoveryEvidenceRefs(input: AIFindingBuildInput): string[] {
  const refs: string[] = [];
  for (const p of input.discovery.aiProviders) {
    for (const e of p.evidence ?? []) {
      refs.push(stableAiId(`disc-ev:${p.id}:${e}`));
    }
  }
  for (const c of input.inventory?.components ?? []) {
    for (const e of c.evidence ?? []) {
      refs.push(stableAiId(`disc-ev:${c.id}:${e}`));
    }
  }
  return [...new Set(refs)].slice(0, 12);
}

export function buildAiFindings(input: AIFindingBuildInput): AIFindingCollection {
  const runtimeContext = {
    llmTeamRunId: input.llmTeamRunId ?? stableAiId("llm-run"),
    organizationId: input.discovery.organizationId,
    projectId: input.discovery.projectId,
    graph: input.graph,
    invariants: input.invariants,
    attacks: input.attacks,
    specialistSummary: input.specialistSummary,
    profile: DEFAULT_AI_RUNTIME_PROFILE,
    budget: DEFAULT_AI_RUNTIME_BUDGET,
    limits: DEFAULT_AI_RUNTIME_LIMITS,
  };

  const plans = planAiExecutions(runtimeContext);
  const planById = new Map(plans.map((p) => [p.id, p]));

  const raw: AIFinding[] = [];

  for (const execution of input.runtimeSummary.results) {
    if (!isValidatedRuntimeEvidence(execution)) continue;

    const plan = planById.get(execution.planId);
    const invariantId = execution.violatedInvariantId ?? plan?.targetInvariantId;
    if (!invariantId) continue;

    const invariant = input.invariants.invariants.find((i) => i.id === invariantId);
    if (!invariant) continue;

    const attack =
      execution.attackCaseId != null
        ? input.attacks.cases.find((c) => c.id === execution.attackCaseId) ?? null
        : plan?.targetAttackCaseId
          ? input.attacks.cases.find((c) => c.id === plan.targetAttackCaseId) ?? null
          : null;

    const specialistObservations = input.specialistSummary.results
      .filter((r) => r.specialistId === execution.specialistId)
      .flatMap((r) => r.observations)
      .filter((o) => o.attackCaseId === attack?.id || o.invariantId === invariant.id);

    const confidence = findingConfidenceFromExecution(execution);
    if (confidence === "unsupported") continue;

    const category =
      (attack && ATTACK_TO_FINDING_CATEGORY[attack.category]) ?? "prompt_injection";

    const capability = mapAttackerCapability(attack);
    const severity = findingSeverity({ invariant, attack, execution, confidence, capability });

    const findingKey = `${invariant.invariantKey}:${attack?.attackKey ?? "runtime"}:${execution.executionId}`;
    const findingId = stableAiId(`finding:${findingKey}`);

    const preconditions = buildAttackPreconditions({
      graph: input.graph,
      invariant,
      attack,
      execution,
    });

    const evidence = mapRuntimeToFindingEvidence(execution.executionId, execution.evidence);

    for (const obs of specialistObservations.slice(0, 2)) {
      evidence.push({
        id: stableAiId(`find-ev:spec:${obs.id}`),
        source: "specialist",
        detail: obs.detail,
        confidence: obs.confidence === "confirmed" ? 0.9 : 0.75,
        refId: obs.id,
        executionId: execution.executionId,
      });
    }

    const fixContext = buildFixContext({ invariant, attack });
    const replayPlan = buildReplayPlan({
      findingId,
      invariant,
      attack,
      execution,
      preconditions,
    });

    const graphNodeIds = [
      ...new Set([
        ...invariant.relationships.graphNodeIds,
        ...execution.executedSteps.map((s) => s.nodeId).filter((x): x is string => Boolean(x)),
      ]),
    ];

    raw.push({
      findingId,
      findingKey,
      title: attack?.title ?? `AI trust violation: ${invariant.title}`,
      description: execution.expectedImpact ?? attack?.description ?? invariant.description,
      category,
      severity,
      confidence,
      status: confidence === "confirmed" ? "confirmed" : "candidate",
      impact: {
        summary: execution.expectedImpact ?? invariant.protectedValueDescription,
        businessImpact: execution.expectedImpact ?? "Modeled trust property may fail in production.",
        trustImpact: invariant.protectedValueDescription,
        affectedAssets: invariant.protectedAssets,
      },
      evidence,
      attackPreconditions: preconditions,
      replayPlan,
      fixContext,
      correlation: {
        keys: [findingKey],
        trustBoundaryId: invariant.protectedTrustBoundaryId,
        invariantId: invariant.id,
        invariantKey: invariant.invariantKey,
        attackCaseId: attack?.id ?? null,
        attackKey: attack?.attackKey ?? null,
        executionPathId: attack?.sequence.executionPathId ?? invariant.relationships.executionPathId,
        rootCause: attack?.description ?? invariant.description,
        affectedComponentNodeIds: invariant.relationships.protectedComponentNodeIds,
      },
      traceability: {
        discoveryEvidenceRefIds: discoveryEvidenceRefs(input),
        graphNodeIds,
        graphEdgeIds: invariant.relationships.graphEdgeIds,
        trustBoundaryId: invariant.protectedTrustBoundaryId,
        invariantId: invariant.id,
        invariantKey: invariant.invariantKey,
        attackCaseId: attack?.id ?? null,
        attackPreconditionsId: stableAiId(`pre:${findingId}`),
        specialistId: execution.specialistId,
        runtimeExecutionId: execution.executionId,
        replayPlanId: replayPlan.id,
      },
      specialistIds: [execution.specialistId],
      executionSummary: `Runtime ${execution.executionId} validated invariant violation with ${evidence.filter((e) => e.source === "runtime").length} runtime evidence item(s).`,
      metadata: {
        llmTeamRunId: input.llmTeamRunId ?? null,
        executionId: execution.executionId,
        planId: execution.planId,
        specialistId: execution.specialistId,
        executionMode: execution.executionMode,
        executionClassification: execution.classification,
        attackCategory: attack?.category ?? null,
        generatedAt: new Date().toISOString(),
        providerFamily: null,
      },
    });
  }

  const correlated = correlateFindings(raw);
  const collection: AIFindingCollection = {
    id: stableAiId(`findings:${input.graph.id}`),
    executionGraphId: input.graph.id,
    generatedAt: new Date().toISOString(),
    findings: correlated,
    validationIssues: [],
  };

  return validateFindingCollection(collection);
}

export const AIFindingBuilder = {
  build: buildAiFindings,
};
