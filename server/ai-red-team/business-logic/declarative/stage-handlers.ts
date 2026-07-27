import type { DiscoveryReport } from "../../discovery/types";
import type { AttackPlan } from "../../types";
import type { PipelineStageHandlers } from "../../core/declarative/pipeline/pipeline.types";
import type { BusinessLogicSpecialistRegistry } from "../registry/business-logic-specialist-registry";
import { buildBusinessLogicTeamContext } from "../discovery";
import { buildBusinessDomainModel } from "../model";
import { extractBusinessInvariants } from "../invariants";
import { generateBusinessAbuseCases } from "../abuse";
import { buildBusinessLogicSpecialistContext, runBusinessLogicSpecialists } from "../specialists";
import { BusinessLogicRuntime } from "../runtime";
import { buildBusinessLogicFindings } from "../findings";
import { computeStepCoverage } from "../../core/coverage/coverage.types";
import {
  BUSINESS_LOGIC_NO_WORKFLOWS_DEFERRAL,
} from "../business-logic.config";

type TeamContext = ReturnType<typeof buildBusinessLogicTeamContext>;

function teamContext(ctx: import("../../core/declarative/pipeline/pipeline.types").PipelineContext): TeamContext {
  const existing = ctx.artifacts.teamContext as TeamContext | undefined;
  if (existing) return existing;
  const discovery = ctx.artifacts.discoveryReport as DiscoveryReport;
  const plan = ctx.metadata.plan as AttackPlan;
  const built = buildBusinessLogicTeamContext({
    businessLogicTeamRunId: String(ctx.metadata.businessLogicTeamRunId),
    redTeamRunId: ctx.runId,
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    discovery,
    plan,
  });
  ctx.artifacts.teamContext = built;
  return built;
}

export function createRt9StageHandlers(registry: BusinessLogicSpecialistRegistry): PipelineStageHandlers {
  return {
    discovery: async (ctx) => {
      const context = teamContext(ctx);
      if (context.workflows.length === 0) {
        return {
          status: "skipped",
          skipReason: BUSINESS_LOGIC_NO_WORKFLOWS_DEFERRAL,
          outputs: { teamContext: context },
        };
      }
      return { status: "completed", outputs: { teamContext: context, "artifact:discovery": context } };
    },
    graph: async (ctx) => {
      const context = teamContext(ctx);
      if (context.workflows.length === 0) return { status: "skipped", skipReason: "No workflows." };
      context.domainModel = buildBusinessDomainModel(context);
      return { status: "completed", outputs: { teamContext: context, domainModel: context.domainModel, "artifact:graph": context.domainModel } };
    },
    trust_boundaries: async (ctx) => {
      const domain = (ctx.artifacts.teamContext as TeamContext)?.domainModel;
      if (!domain) return { status: "skipped", skipReason: "No domain model." };
      return { status: "completed", outputs: { "artifact:trust_boundaries": domain.validationIssues.length } };
    },
    invariants: async (ctx) => {
      const context = ctx.artifacts.teamContext as TeamContext | undefined;
      if (!context?.domainModel) return { status: "skipped", skipReason: "No domain model." };
      context.domainModel.invariantCollection = extractBusinessInvariants({
        domain: context.domainModel,
        discoverySignals: context.signals,
      });
      return { status: "completed", outputs: { teamContext: context, "artifact:invariants": context.domainModel.invariantCollection } };
    },
    attack_generation: async (ctx) => {
      const context = ctx.artifacts.teamContext as TeamContext | undefined;
      if (!context?.domainModel) return { status: "skipped", skipReason: "No domain model." };
      const abuseResult = generateBusinessAbuseCases({ domain: context.domainModel });
      context.domainModel.abuseCollection = abuseResult.collection;
      return { status: "completed", outputs: { teamContext: context, "artifact:attack_generation": abuseResult.collection } };
    },
    specialist_selection: async (ctx) => {
      const context = ctx.artifacts.teamContext as TeamContext | undefined;
      if (!context?.domainModel) return { status: "skipped", skipReason: "No domain model." };
      const specialistContext = buildBusinessLogicSpecialistContext(context);
      if (!specialistContext) return { status: "skipped", skipReason: "No specialist context." };
      const specialistSummary = await runBusinessLogicSpecialists({
        registry,
        context: specialistContext,
        signal: ctx.signal,
      });
      context.domainModel.specialistExecution = specialistSummary;
      return {
        status: "completed",
        outputs: {
          teamContext: context,
          specialistContext,
          specialistSummary,
          "artifact:specialist_selection": specialistSummary,
        },
      };
    },
    runtime_selection: async () => ({
      status: "completed",
      outputs: { "artifact:runtime_selection": "mock_runtime" },
    }),
    execution: async (ctx) => {
      const specialistContext = ctx.artifacts.specialistContext;
      const context = ctx.artifacts.teamContext as TeamContext | undefined;
      if (!specialistContext || !context?.domainModel) {
        return { status: "skipped", skipReason: "Missing specialist/runtime context." };
      }
      const runtimeSummary = await BusinessLogicRuntime.run({
        context: specialistContext as never,
        signal: ctx.signal,
      });
      context.domainModel.runtimeExecution = runtimeSummary;
      return { status: "completed", outputs: { teamContext: context, runtimeSummary, "artifact:execution": runtimeSummary } };
    },
    evidence: async (ctx) => {
      const runtime = (ctx.artifacts.teamContext as TeamContext | undefined)?.domainModel?.runtimeExecution;
      if (!runtime) return { status: "skipped", skipReason: "No runtime." };
      return { status: "completed", outputs: { "artifact:evidence": runtime.plansCompleted } };
    },
    confidence: async () => ({ status: "completed", outputs: { "artifact:confidence": "runtime_weighted" } }),
    findings: async (ctx) => {
      const context = ctx.artifacts.teamContext as TeamContext | undefined;
      if (!context?.domainModel) return { status: "skipped", skipReason: "No domain model." };
      context.domainModel.findingCollection = buildBusinessLogicFindings({
        domain: context.domainModel,
        businessLogicTeamRunId: String(ctx.metadata.businessLogicTeamRunId),
      });
      return { status: "completed", outputs: { teamContext: context, findings: context.domainModel.findingCollection, "artifact:findings": context.domainModel.findingCollection } };
    },
    replay: async (ctx) => {
      const collection = (ctx.artifacts.teamContext as TeamContext | undefined)?.domainModel?.findingCollection;
      if (!collection) return { status: "skipped", skipReason: "No findings." };
      return { status: "completed", outputs: { "artifact:replay": collection.findings.length } };
    },
    coverage: async (ctx) => {
      const context = ctx.artifacts.teamContext as TeamContext | undefined;
      const domain = context?.domainModel;
      const coveragePercent = computeStepCoverage([
        (context?.workflows.length ?? 0) > 0,
        (domain?.invariantCollection?.invariants.length ?? 0) > 0,
        (domain?.abuseCollection?.cases.length ?? 0) > 0,
        (domain?.specialistExecution?.specialistsCompleted ?? 0) > 0,
        (domain?.runtimeExecution?.plansCompleted ?? 0) > 0,
        (domain?.findingCollection?.findings.length ?? 0) >= 0,
      ]);
      return { status: "completed", outputs: { coveragePercent, "artifact:coverage": coveragePercent } };
    },
    platform_integration: async () => ({
      status: "skipped",
      skipReason: "Platform payload built by BusinessLogicTeamAgent.",
    }),
  };
}
