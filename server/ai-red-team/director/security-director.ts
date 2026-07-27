import type { ApplicationContext, AttackRequest, RedTeamReport } from "../types";
import type { AgentRegistry } from "../agents/registry";
import type { RedTeamLogger } from "../logging/red-team-logger";
import { createRedTeamLogger } from "../logging/red-team-logger";
import { AttackPlanner, createAttackPlanner } from "../execution/attack-planner";
import { AttackOrchestrator, createAttackOrchestrator } from "../execution/attack-orchestrator";
import {
  DiscoveryEngine,
  createDiscoveryEngine,
  attackSurfaceToCapabilities,
} from "../discovery";
import type { DiscoveryReport } from "../discovery/types";
import { validateAttackAuthorization } from "../authorization";
import { isFeatureEnabled } from "@/server/feature-flags";
import type { RedTeamRunStore } from "../runs/red-team-run-store";
import { requestRedTeamBrowserRun } from "../runs/request-red-team-run";
import {
  createSecurityIntelligenceEngine,
  type SecurityIntelligenceEngine,
} from "../intelligence/engine";
import type { ProductionMemorySnapshot } from "../intelligence/models";
import {
  createSecurityDecisionEngine,
  type SecurityDecisionEngine,
} from "../decision/decision-engine";
import { buildDecisionContextFromRequest } from "../decision/build-decision-context";
import { intelligenceVerdictFromDecision } from "../decision/production-verdict-bridge";
import { globalProjectDecisionStore } from "../decision/project-decision-store";
import {
  resolveDirectorPipelineScope,
} from "./pipeline";
import { buildRedTeamProductionVerdict } from "../verdict/red-team-production-verdict";
import { createFixStrategyEngine, type FixStrategyEngine } from "../fix-strategy/fix-strategy-engine";
import {
  createAutonomousSecurityOrchestrator,
  type AutonomousSecurityOrchestrator,
} from "../autonomous-orchestrator/aso-engine";

export type DiscoveryProvider = (
  request: AttackRequest
) => Promise<import("../discovery/types").DiscoveryRepositoryInput>;

export type SecurityDirectorDeps = {
  registry: AgentRegistry;
  planner?: AttackPlanner;
  orchestrator?: AttackOrchestrator;
  logger?: RedTeamLogger;
  discoveryEngine?: DiscoveryEngine;
  discoveryProvider?: DiscoveryProvider;
  redTeamRunStore?: RedTeamRunStore;
  intelligenceEngine?: SecurityIntelligenceEngine;
  /** Optional Production Memory snapshot for intelligence linking (RT4). */
  productionMemory?: ProductionMemorySnapshot | null;
  decisionEngine?: SecurityDecisionEngine;
  fixStrategyEngine?: FixStrategyEngine;
  autonomousOrchestrator?: AutonomousSecurityOrchestrator;
};

function mergeApplicationMetadata(
  base: ApplicationContext["metadata"],
  patch: Record<string, unknown>,
): NonNullable<ApplicationContext["metadata"]> {
  return { ...(base ?? {}), ...patch };
}

function fixStrategyReplayStatus(
  status: import("../decision/decision-context").ReplayStatus | undefined,
): "not_run" | "passed" | "failed" {
  return status === "passed" || status === "failed" ? status : "not_run";
}

export class SecurityDirector {
  private readonly registry: AgentRegistry;
  private readonly planner: AttackPlanner;
  private readonly orchestrator: AttackOrchestrator;
  private readonly logger: RedTeamLogger;
  private readonly discoveryEngine: DiscoveryEngine;
  private readonly discoveryProvider?: DiscoveryProvider;
  private readonly redTeamRunStore?: RedTeamRunStore;
  private readonly intelligenceEngine: SecurityIntelligenceEngine;
  private readonly productionMemory?: ProductionMemorySnapshot | null;
  private readonly decisionEngine: SecurityDecisionEngine;
  private readonly fixStrategyEngine: FixStrategyEngine;
  private readonly autonomousOrchestrator: AutonomousSecurityOrchestrator;

  constructor(deps: SecurityDirectorDeps) {
    this.registry = deps.registry;
    this.planner = deps.planner ?? createAttackPlanner();
    this.orchestrator = deps.orchestrator ?? createAttackOrchestrator();
    this.logger = deps.logger ?? createRedTeamLogger();
    this.discoveryEngine = deps.discoveryEngine ?? createDiscoveryEngine();
    this.discoveryProvider = deps.discoveryProvider;
    this.redTeamRunStore = deps.redTeamRunStore;
    this.intelligenceEngine = deps.intelligenceEngine ?? createSecurityIntelligenceEngine();
    this.productionMemory = deps.productionMemory;
    this.decisionEngine = deps.decisionEngine ?? createSecurityDecisionEngine();
    this.fixStrategyEngine = deps.fixStrategyEngine ?? createFixStrategyEngine();
    this.autonomousOrchestrator = deps.autonomousOrchestrator ?? createAutonomousSecurityOrchestrator();
  }

  async run(request: AttackRequest): Promise<RedTeamReport> {
    this.logger.log({
      event: "director_started",
      requestId: request.requestId,
      metadata: { projectId: request.context.projectId },
    });

    try {
      const discovery = await this.runDiscovery(request);

      let enrichedContext: ApplicationContext = {
        ...request.context,
        declaredCapabilities: [
          ...new Set([
            ...(request.context.declaredCapabilities ?? []),
            ...attackSurfaceToCapabilities(discovery.potentialAttackSurface),
          ]),
        ],
        metadata: mergeApplicationMetadata(request.context.metadata, {
          discoveryReportId: discovery.reportId,
          discoveryCommitSha: discovery.commitSha,
          discoveryConfidence: discovery.confidenceScore,
        }),
      };

      this.logger.log({ event: "planning_started", requestId: request.requestId });

      let orchestratorDecision: import("../types").RedTeamReport["orchestrator"];
      let orchestratedScope = resolveDirectorPipelineScope(request);
      let orchestratedDomainOrder: import("../types").AttackDomain[] | undefined;
      let runOptions = { ...(request.options ?? {}) };

      if (
        isFeatureEnabled("autonomous_orchestrator", {
          organizationId: request.context.organizationId,
        })
      ) {
        orchestratorDecision = this.autonomousOrchestrator.plan({
          requestId: request.requestId,
          organizationId: request.context.organizationId,
          projectId: request.context.projectId,
          discovery,
          memory: request.intelligenceContext?.memory ?? this.productionMemory ?? null,
          budgetMode: request.orchestrator?.budgetMode,
          userPreferences: request.orchestrator?.userPreferences,
          previousReplayFailed:
            request.orchestrator?.previousReplayFailed ??
            request.decisionContext?.replayStatus === "failed",
          parallelExecutionEnabled: isFeatureEnabled("parallel_execution", {
            organizationId: request.context.organizationId,
          }),
          adaptiveTeamSelection: isFeatureEnabled("adaptive_team_selection", {
            organizationId: request.context.organizationId,
          }),
        });
        if (orchestratorDecision.executionPlan.attackDomains.length > 0) {
          orchestratedScope = orchestratorDecision.executionPlan.attackDomains;
          orchestratedDomainOrder = orchestratorDecision.executionPlan.domainOrder;
        }
        runOptions.maxParallel = orchestratorDecision.executionPlan.maxParallel;
        enrichedContext = {
          ...enrichedContext,
          metadata: mergeApplicationMetadata(enrichedContext.metadata, {
            orchestratorPlan: orchestratorDecision.executionPlan,
          }),
        };
      }

      const plan = this.planner.createPlan({
        context: enrichedContext,
        scope: orchestratedScope,
        domainOrder:
          orchestratedDomainOrder ??
          (request.directorPipeline !== false &&
          (request.attackSimulation || request.directorPipeline === true)
            ? orchestratedScope
            : undefined),
      });
      this.logger.log({
        event: "planning_completed",
        requestId: request.requestId,
        planId: plan.planId,
        metadata: { phaseCount: plan.phases.length },
      });

      if (request.attackSimulation) {
        const browserEnabled = isFeatureEnabled("browser_team", {
          organizationId: request.context.organizationId,
        });
        if (!browserEnabled) {
          throw new Error("BROWSER_TEAM_DISABLED: Browser simulation is not enabled for this organization");
        }
        const authCheck = validateAttackAuthorization(request.attackSimulation.authorization, {
          targetUrl: request.attackSimulation.targetUrl,
        });
        if (!authCheck.ok) {
          throw new Error(`${authCheck.code}: ${authCheck.message}`);
        }
        if (request.attackSimulation.async !== false && this.redTeamRunStore) {
          const queued = await requestRedTeamBrowserRun(this, this.redTeamRunStore, {
            request,
            targetUrl: request.attackSimulation.targetUrl,
            authorization: request.attackSimulation.authorization,
            idempotencyKey: request.attackSimulation.idempotencyKey,
            asyncMode: true,
          });
          if (queued.mode === "async") {
            return {
              requestId: request.requestId,
              discovery,
              plan,
              summary: {
                totalAgents: 0,
                completed: 0,
                skipped: 0,
                failed: 0,
                cancelled: 0,
                timedOut: 0,
                totalFindings: 0,
                totalDurationMs: 0,
                domainsCovered: [],
              },
              results: [],
              executions: [],
              generatedAt: new Date().toISOString(),
              asyncRun: { runId: queued.runId, status: "queued" },
            };
          }
        }
        enrichedContext = {
          ...enrichedContext,
          metadata: mergeApplicationMetadata(enrichedContext.metadata, {
            browserAttack: {
              targetUrl: request.attackSimulation.targetUrl,
              authorization: request.attackSimulation.authorization,
              discovery,
              plan,
              redTeamRunId: request.requestId,
            },
            authenticationAttack: {
              discovery,
              plan,
              redTeamRunId: request.requestId,
            },
            ...(isFeatureEnabled("api_team", { organizationId: request.context.organizationId }) &&
            (!orchestratorDecision || orchestratorDecision.executionPlan.attackDomains.includes("api"))
              ? {
                  apiAttack: {
                    targetOrigin: request.attackSimulation.authorization.targetOrigin,
                    authorization: request.attackSimulation.authorization,
                    discovery,
                    plan,
                    redTeamRunId: request.requestId,
                  },
                }
              : {}),
            ...(isFeatureEnabled("authorization_team", {
              organizationId: request.context.organizationId,
            }) &&
            (!orchestratorDecision ||
              orchestratorDecision.executionPlan.attackDomains.includes("authorization"))
              ? {
                  authorizationAttack: {
                    discovery,
                    plan,
                    redTeamRunId: request.requestId,
                  },
                }
              : {}),
            ...(isFeatureEnabled("business_logic_team", {
              organizationId: request.context.organizationId,
            }) &&
            (!orchestratorDecision ||
              orchestratorDecision.executionPlan.attackDomains.includes("payments"))
              ? {
                  businessLogicAttack: {
                    discovery,
                    plan,
                    redTeamRunId: request.requestId,
                  },
                }
              : {}),
            ...(isFeatureEnabled("llm_team", {
              organizationId: request.context.organizationId,
            }) &&
            (!orchestratorDecision ||
              orchestratorDecision.executionPlan.attackDomains.includes("llm"))
              ? {
                  llmAttack: {
                    discovery,
                    plan,
                    redTeamRunId: request.requestId,
                  },
                }
              : {}),
          }),
        };
      } else if (request.directorPipeline === true) {
        enrichedContext = {
          ...enrichedContext,
          metadata: mergeApplicationMetadata(enrichedContext.metadata, {
            authenticationAttack: {
              discovery,
              plan,
              redTeamRunId: request.requestId,
            },
            ...(isFeatureEnabled("business_logic_team", {
              organizationId: request.context.organizationId,
            })
              ? {
                  businessLogicAttack: {
                    discovery,
                    plan,
                    redTeamRunId: request.requestId,
                  },
                }
              : {}),
            ...(isFeatureEnabled("llm_team", {
              organizationId: request.context.organizationId,
            })
              ? {
                  llmAttack: {
                    discovery,
                    plan,
                    redTeamRunId: request.requestId,
                  },
                }
              : {}),
          }),
        };
      }

      const { results, executions, summary } = await this.orchestrator.execute({
        requestId: request.requestId,
        context: enrichedContext,
        plan,
        registry: this.registry,
        options: runOptions,
        logger: this.logger,
      });

      const intelligence = this.intelligenceEngine.analyze({
        discovery,
        results,
        memory: this.productionMemory ?? request.intelligenceContext?.memory ?? null,
        staticReviewConfidence: request.intelligenceContext?.staticReviewConfidence ?? null,
      });

      const decisionContext = buildDecisionContextFromRequest(request, discovery.commitSha);
      let securityDecision = this.decisionEngine.decide({
        intelligence,
        context: decisionContext,
      });

      const intelligenceWithDecisionVerdict = {
        ...intelligence,
        verdict: intelligenceVerdictFromDecision(securityDecision, intelligence.verdict),
      };

      globalProjectDecisionStore.set({
        projectId: request.context.projectId,
        organizationId: request.context.organizationId,
        commitSha: discovery.commitSha,
        report: securityDecision,
        recordedAt: new Date().toISOString(),
      });

      this.logger.log({
        event: "intelligence_completed",
        requestId: request.requestId,
        metadata: {
          intelligenceReportId: intelligence.reportId,
          verdict: intelligenceWithDecisionVerdict.verdict.status,
          chains: intelligence.attackChains.length,
          correlations: intelligence.correlations.length,
        },
      });

      this.logger.log({
        event: "decision_completed",
        requestId: request.requestId,
        metadata: {
          decisionId: securityDecision.decision.decisionId,
          deploymentVerdict: securityDecision.decision.deploymentVerdict,
          policies: securityDecision.decision.policiesTriggered,
        },
      });

      const productionVerdict = buildRedTeamProductionVerdict(securityDecision);

      let fixStrategy: RedTeamReport["fixStrategy"];
      let universalEngineering: RedTeamReport["universalEngineering"];
      const engineeringEnabled =
        isFeatureEnabled("universal_engineering_engine", {
          organizationId: request.context.organizationId,
        }) ||
        isFeatureEnabled("fix_strategy_engine", {
          organizationId: request.context.organizationId,
        });
      if (engineeringEnabled) {
        const orch = orchestratorDecision?.executionPlan;
        fixStrategy = this.fixStrategyEngine.plan({
          organizationId: request.context.organizationId,
          projectId: request.context.projectId,
          requestId: request.requestId,
          discovery,
          intelligence: intelligenceWithDecisionVerdict,
          results,
          securityDecision,
          productionVerdict,
          replayStatus: fixStrategyReplayStatus(decisionContext.replayStatus),
          previousStrategyRevision: request.decisionContext?.fixStrategyRevision,
          preferredAI:
            request.decisionContext?.preferredAI ?? orch?.preferredAI ?? null,
          generateAllAdapters:
            request.decisionContext?.generateAllEngineeringAdapters ??
            orch?.generateAllAdapters,
        });
        universalEngineering = fixStrategy.universalEngineering;
      }

      this.logger.log({
        event: "production_verdict_completed",
        requestId: request.requestId,
        metadata: {
          status: productionVerdict.status,
          decisionId: productionVerdict.decisionId,
        },
      });

      const report: RedTeamReport = {
        requestId: request.requestId,
        discovery,
        plan,
        summary,
        results,
        executions,
        generatedAt: new Date().toISOString(),
        intelligence: intelligenceWithDecisionVerdict,
        securityDecision,
        productionVerdict,
        fixStrategy,
        universalEngineering,
        orchestrator: orchestratorDecision,
      };

      this.logger.log({
        event: "director_completed",
        requestId: request.requestId,
        planId: plan.planId,
        durationMs: summary.totalDurationMs,
      });

      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log({
        event: "director_error",
        requestId: request.requestId,
        error: message,
      });
      throw error;
    }
  }

  private async runDiscovery(request: AttackRequest): Promise<DiscoveryReport> {
    let repositoryInput = request.discoveryRepository;
    if (!repositoryInput) {
      if (!this.discoveryProvider) {
        throw new Error(
          "Discovery requires discoveryRepository on the request or a configured discoveryProvider"
        );
      }
      repositoryInput = await this.discoveryProvider(request);
    }
    return this.discoveryEngine.discover(repositoryInput);
  }
}

export function createSecurityDirector(deps: SecurityDirectorDeps): SecurityDirector {
  return new SecurityDirector(deps);
}
