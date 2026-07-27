import { randomUUID } from "node:crypto";
import { isFeatureEnabled } from "@/server/feature-flags";
import { BaseAgent, type AgentExecutionInput } from "../agents/base-agent";
import type { AttackResult } from "../types";
import type { BusinessLogicTeamCoordinator } from "./coordinator";
import type { BusinessLogicAttackContext } from "./business-logic.types";
import { toAttackFinding } from "./findings/business-logic-finding";
import { buildBusinessLogicPlatformPayload } from "./integration/platform-payload";
import type { BusinessLogicRunStore } from "./persistence/store.types";
import { isBusinessLogicPersistenceEnabled } from "./persistence/feature-gate";
import { persistBusinessLogicRun } from "./persistence/persist-business-logic-run";
import {
  attachCounts,
  BusinessLogicPerformanceTracker,
} from "./observability/performance-tracker";
import { buildOperationalMetrics, emitBusinessLogicTelemetry } from "./observability/telemetry";
import { createRedTeamLogger } from "../logging/red-team-logger";

export function readBusinessLogicAttackContext(
  input: AgentExecutionInput
): BusinessLogicAttackContext | null {
  const raw = input.context.metadata?.businessLogicAttack;
  if (!raw || typeof raw !== "object") return null;
  const ctx = raw as BusinessLogicAttackContext;
  if (!ctx.discovery || !ctx.plan) return null;
  return ctx;
}

function teamExecutionStatus(
  result: Awaited<ReturnType<BusinessLogicTeamCoordinator["run"]>>
): "completed" | "skipped" | "failed" {
  if (result.status === "failed") return "failed";
  if (result.status === "skipped") return "skipped";
  return "completed";
}

export class BusinessLogicTeamAgent extends BaseAgent {
  readonly id = "logic.business";
  readonly name = "Business Logic Team";
  readonly description =
    "Business workflow and invariant reasoning — subscriptions, limits, and economic abuse paths.";
  readonly priority = 55;
  readonly domain = "payments" as const;
  readonly requiredCapabilities = ["payments"] as const;

  constructor(
    private readonly coordinator: BusinessLogicTeamCoordinator,
    private readonly runStore?: BusinessLogicRunStore
  ) {
    super();
  }

  async canRun(context: import("../types").ApplicationContext): Promise<boolean> {
    if (
      !isFeatureEnabled("business_logic_team", {
        organizationId: context.organizationId,
      })
    ) {
      return false;
    }
    const caps = context.declaredCapabilities ?? [];
    if (!caps.includes("payments")) return false;
    return Boolean(context.metadata?.businessLogicAttack);
  }

  async execute(input: AgentExecutionInput): Promise<AttackResult> {
    const startedAt = Date.now();
    const attackCtx = readBusinessLogicAttackContext(input);
    if (!attackCtx) {
      return {
        agentId: this.id,
        agentName: this.name,
        domain: this.domain,
        status: "skipped",
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        findings: [],
        evidence: [],
        logs: ["Business Logic Team skipped — missing businessLogicAttack context"],
        metadata: {
          team: "business_logic",
          skippedReason: "missing_business_logic_attack_context",
          teamExecution: { business_logic: "skipped" },
        },
      };
    }

    const perf = new BusinessLogicPerformanceTracker();
    perf.mark("totalMs");

    const result = await this.coordinator.run({
      organizationId: input.context.organizationId,
      projectId: input.context.projectId,
      runId: attackCtx.redTeamRunId ?? input.requestId,
      requestId: input.requestId,
      discoveryReport: attackCtx.discovery,
      plan: attackCtx.plan,
      signal: input.signal,
    });

    const finishedAt = Date.now();
    const platform = buildBusinessLogicPlatformPayload(result);
    const performanceSnapshot = attachCounts(
      perf.finalize(finishedAt - startedAt),
      {
        specialistCount: result.specialistsCompleted,
        findingCount: result.findingsCount,
        workflowCount: result.workflowsDiscovered,
      }
    );
    const operationalMetrics = buildOperationalMetrics({
      platform,
      teamDurationMs: result.durationMs,
      performance: performanceSnapshot,
    });

    const logger = createRedTeamLogger();
    emitBusinessLogicTelemetry(logger, "business_logic_metrics", input.requestId, {
      businessLogicRunId: result.businessLogicTeamRunId,
      metrics: operationalMetrics,
      performance: performanceSnapshot.phases,
    });

    let persistenceRevision: number | null = null;
    if (
      isBusinessLogicPersistenceEnabled({ organizationId: input.context.organizationId }) &&
      this.runStore
    ) {
      const persistStarted = Date.now();
      emitBusinessLogicTelemetry(logger, "business_logic_persist_started", input.requestId, {
        businessLogicRunId: result.businessLogicTeamRunId,
      });
      try {
        const persistOutcome = await persistBusinessLogicRun(
          {
            result,
            organizationId: input.context.organizationId,
            projectId: input.context.projectId,
            redTeamRunId: attackCtx.redTeamRunId ?? null,
            scanJobId:
              typeof input.context.metadata?.scanJobId === "string"
                ? input.context.metadata.scanJobId
                : null,
            idempotencyKey: `bl:${input.context.projectId}:${result.businessLogicTeamRunId}`,
            startedAtIso: new Date(startedAt).toISOString(),
            completedAtIso: new Date(finishedAt).toISOString(),
          },
          {
            store: this.runStore,
            performanceMs: Date.now() - persistStarted,
          }
        );
        persistenceRevision = persistOutcome?.revision ?? null;
        emitBusinessLogicTelemetry(logger, "business_logic_persist_completed", input.requestId, {
          businessLogicRunId: result.businessLogicTeamRunId,
          revision: persistenceRevision,
          counts: persistOutcome?.counts,
        });
      } catch (err) {
        emitBusinessLogicTelemetry(logger, "business_logic_persist_failed", input.requestId, {
          businessLogicRunId: result.businessLogicTeamRunId,
          message: err instanceof Error ? err.message : "persist_failed",
        });
      }
    }

    const collection = result.context?.domainModel?.findingCollection;
    const findings = (collection?.findings ?? []).map(toAttackFinding);
    const replayPlans = (collection?.findings ?? []).map((f) => ({
      replayPlanId: f.replayPlan.id,
      findingId: f.findingId,
      executable: f.replayPlan.executable,
      team: "business_logic",
    }));
    const execStatus = teamExecutionStatus(result);

    return {
      agentId: this.id,
      agentName: this.name,
      domain: this.domain,
      status: result.status === "failed" ? "failed" : result.status === "skipped" ? "skipped" : "completed",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      findings,
      evidence: [
        {
          id: randomUUID(),
          kind: "business_logic_team_summary",
          label: "Business Logic team summary",
          detail: result.deferralReason ?? result.skippedReason ?? "Business Logic Team finished.",
          capturedAt: new Date(finishedAt).toISOString(),
          metadata: {
            businessLogicTeamRunId: result.businessLogicTeamRunId,
            analysisPhase: result.analysisPhase,
            executionMode: result.executionMode,
            workflowsDiscovered: result.workflowsDiscovered,
            entitiesDiscovered: result.context?.entities.length ?? 0,
            stateMachinesBuilt: result.context?.domainModel?.stateMachines.length ?? 0,
            workflowKinds: result.context?.workflows.map((w) => w.kind) ?? [],
            invariantsExtracted: result.invariantsExtracted,
            abuseHypothesesGenerated: result.abuseHypothesesGenerated,
            specialistObservationsGenerated: result.specialistObservationsGenerated,
            specialistsCompleted: result.specialistsCompleted,
            runtimeExecutionsCompleted: result.runtimeExecutionsCompleted,
            findingsCount: result.findingsCount,
            coveragePercent: platform.coverage.coveragePercent,
            deferralReason: result.deferralReason ?? null,
            skippedReason: result.skippedReason ?? null,
          },
        },
      ],
      logs: [
        `Business Logic Team ${result.status}`,
        result.deferralReason ?? result.skippedReason ?? "",
        `analysisPhase=${result.analysisPhase}`,
        `executionMode=${result.executionMode}`,
        `findings=${findings.length}`,
      ],
      metadata: {
        team: "business_logic",
        businessLogicTeamRunId: result.businessLogicTeamRunId,
        analysisPhase: result.analysisPhase,
        executionMode: result.executionMode,
        workflowsDiscovered: result.workflowsDiscovered,
        invariantsExtracted: result.invariantsExtracted,
        abuseHypothesesGenerated: result.abuseHypothesesGenerated,
        specialistObservationsGenerated: result.specialistObservationsGenerated,
        specialistsCompleted: result.specialistsCompleted,
        runtimeExecutionsCompleted: result.runtimeExecutionsCompleted,
        findingsCount: result.findingsCount,
        deferralReason: result.deferralReason ?? null,
        skippedReason: result.skippedReason ?? null,
        businessLogicPlatform: platform,
        businessLogicMetrics: platform.missionControl,
        replayPlans,
        teamExecution: { business_logic: execStatus },
        ueeRemediationInputs: platform.ueeRemediationInputs,
        asoOrchestration: platform.asoOrchestration,
        decisionExposure: platform.decisionExposure,
        operationalMetrics,
        performance: performanceSnapshot.phases,
        persistenceRevision,
      },
    };
  }
}
