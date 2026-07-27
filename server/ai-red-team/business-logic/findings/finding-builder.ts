import { createHash, randomUUID } from "node:crypto";
import type { BusinessDomainModel } from "../model/domain.types";
import type { BusinessLogicExecutionPlan } from "../runtime/runtime.types";
import { BusinessLogicExecutionPlanner } from "../runtime/execution-planner";
import type {
  BusinessLogicFinding,
  BusinessLogicFindingCategory,
  BusinessLogicFindingCollection,
  FindingBuildInput,
} from "./finding.types";
import { findingConfidenceFromExecution, findingSeverity } from "./finding-severity";
import { buildMitigation } from "./finding-mitigation";
import { buildReplayPlan } from "./finding-replay";
import { mapRuntimeEvidence } from "./finding-correlation";
import { correlateFindings } from "./finding-correlation";
import { validateFindingCollection } from "./finding-validator";

function stableFindingId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function planById(domain: BusinessDomainModel): Map<string, BusinessLogicExecutionPlan> {
  const summary = domain.specialistExecution;
  if (!summary) return new Map();
  const plans = BusinessLogicExecutionPlanner.planFromSpecialists({
    domain,
    specialistSummary: summary,
  });
  return new Map(plans.map((p) => [p.id, p]));
}

function categoryFor(input: {
  violated: boolean;
  abuseCaseId: string | null;
  valueKind: string;
}): BusinessLogicFindingCategory {
  if (input.abuseCaseId) return "abuse_execution";
  if (input.valueKind === "monetary") return "economic_inconsistency";
  if (input.violated) return "invariant_violation";
  return "workflow_inconsistency";
}

export function buildBusinessLogicFindings(input: FindingBuildInput): BusinessLogicFindingCollection {
  const domain = input.domain;
  const runtime = domain.runtimeExecution;
  const raw: BusinessLogicFinding[] = [];
  const plans = planById(domain);

  if (!runtime) {
    return {
      id: randomUUID(),
      generatedAt: new Date().toISOString(),
      findings: [],
      validationIssues: [{ findingId: "none", code: "missing_runtime", message: "No runtime execution." }],
    };
  }

  for (const execution of runtime.results) {
    if (execution.status !== "completed") continue;

    const plan = plans.get(execution.planId);
    const invariantId = execution.violatedInvariantId ?? plan?.targetInvariantId ?? null;
    if (!invariantId) continue;

    const abuseCase =
      plan?.targetAbuseCaseId != null
        ? domain.abuseCollection?.cases.find((c) => c.id === plan.targetAbuseCaseId) ?? null
        : null;

    const runtimeEvidence = execution.evidence.filter(
      (e) => e.source === "runtime_mock" || e.source === "fsm"
    );
    if (runtimeEvidence.length === 0) continue;
    if (!execution.violatedInvariantId && !abuseCase) continue;

    const invariant = domain.invariantCollection?.invariants.find((i) => i.id === invariantId);
    if (!invariant) continue;

    const workflow = domain.workflows.find((w) => w.id === execution.workflowId);
    if (!workflow) continue;

    const confidence = findingConfidenceFromExecution(execution);
    if (confidence === "unsupported") continue;

    const findingKey = `${invariant.invariantKey}:${workflow.metadata.discoveredWorkflowKind ?? workflow.kind}:${abuseCase?.abuseKey ?? "violation"}`;
    const findingId = stableFindingId(findingKey);

    const category = categoryFor({
      violated: execution.violatedInvariantId !== null,
      abuseCaseId: abuseCase?.id ?? null,
      valueKind: invariant.protectedValueKind,
    });

    const severity = findingSeverity({ invariant, abuseCase, execution, confidence });
    const evidence = mapRuntimeEvidence(execution.executionId, execution.evidence);
    const mitigation = buildMitigation({ invariant, abuseCase });
    const replayPlan = buildReplayPlan({
      findingId,
      invariant,
      abuseCase,
      execution,
      confidence,
    });

    raw.push({
      findingId,
      findingKey,
      title: abuseCase?.title ?? `Business invariant violation: ${invariant.title}`,
      description:
        execution.businessConsequence ??
        abuseCase?.description ??
        invariant.description,
      category,
      severity,
      confidence,
      status: confidence === "confirmed" ? "confirmed" : "candidate",
      workflowId: workflow.id,
      workflowKind: workflow.metadata.discoveredWorkflowKind ?? workflow.kind,
      entityIds: [...new Set([...invariant.entityIds, ...(abuseCase?.targetEntityIds ?? [])])],
      invariantIds: [invariant.id],
      invariantKeys: [invariant.invariantKey],
      transitionIds: [
        ...new Set([
          ...invariant.supportingTransitionIds,
          ...execution.validatedTransitions.map((t) => t.transitionId).filter(Boolean) as string[],
        ]),
      ],
      specialistIds: [execution.specialistId],
      businessImpact: abuseCase?.businessImpact ?? invariant.potentialImpact,
      economicImpact:
        invariant.protectedValueKind === "monetary"
          ? invariant.protectedValueDescription
          : "Non-monetary business value at risk.",
      replayPlan,
      mitigation,
      evidence,
      supportingAssumptions: [
        ...execution.validatedAssumptions,
        ...invariant.assumptions,
      ],
      executionSummary: `Runtime ${execution.executionMode} — ${execution.classification} (${execution.durationMs}ms).`,
      correlation: {
        keys: [findingKey],
        workflowId: workflow.id,
        invariantId: invariant.id,
        invariantKey: invariant.invariantKey,
        abuseCaseId: abuseCase?.id ?? null,
        abuseKey: abuseCase?.abuseKey ?? null,
        workflowKind: workflow.metadata.discoveredWorkflowKind ?? workflow.kind,
        businessValueKind: invariant.protectedValueKind,
      },
      metadata: {
        businessLogicTeamRunId: input.businessLogicTeamRunId ?? null,
        executionId: execution.executionId,
        planId: execution.planId,
        specialistId: execution.specialistId,
        executionMode: execution.executionMode,
        executionClassification: execution.classification,
        abuseCategory: abuseCase?.category ?? null,
        generatedAt: new Date().toISOString(),
      },
    });
  }

  const merged = correlateFindings(raw);
  const collection: BusinessLogicFindingCollection = {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
    findings: merged,
    validationIssues: [],
  };

  return validateFindingCollection(collection);
}

export const BusinessLogicFindingBuilder = {
  build: buildBusinessLogicFindings,
};

export function buildBusinessLogicFindingsEngine(input: FindingBuildInput): BusinessLogicFindingCollection {
  return buildBusinessLogicFindings(input);
}
