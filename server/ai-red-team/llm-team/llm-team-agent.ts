import { randomUUID } from "node:crypto";
import { BaseAgent, type AgentExecutionInput } from "../agents/base-agent";
import type { AttackResult } from "../types";
import type { LlmTeamCoordinator } from "./coordinator";
import type { LlmTeamAttackContext } from "./llm-team.types";
import { toAttackFinding } from "./findings/llm-finding";
import { buildLlmPlatformPayload } from "./integration/platform-payload";
import { isLlmTeamEnabled } from "./integration/feature-gate";

export function readLlmAttackContext(input: AgentExecutionInput): LlmTeamAttackContext | null {
  const raw = input.context.metadata?.llmAttack;
  if (!raw || typeof raw !== "object") return null;
  const ctx = raw as LlmTeamAttackContext;
  if (!ctx.discovery || !ctx.plan) return null;
  return ctx;
}

function teamExecutionStatus(
  result: Awaited<ReturnType<LlmTeamCoordinator["run"]>>
): "completed" | "skipped" | "failed" {
  if (result.status === "failed") return "failed";
  if (result.status === "skipped") return "skipped";
  return "completed";
}

export class LlmTeamAgent extends BaseAgent {
  readonly id = "ai.llm";
  readonly name = "LLM / AI Security Team";
  readonly description =
    "AI execution graph, trust invariants, and safe runtime validation for LLM applications.";
  readonly priority = 60;
  readonly domain = "llm" as const;
  readonly requiredCapabilities = ["llm"] as const;

  constructor(private readonly coordinator: LlmTeamCoordinator) {
    super();
  }

  async canRun(context: import("../types").ApplicationContext): Promise<boolean> {
    if (!isLlmTeamEnabled({ organizationId: context.organizationId })) {
      return false;
    }
    const caps = context.declaredCapabilities ?? [];
    if (!caps.includes("llm")) return false;
    return Boolean(context.metadata?.llmAttack);
  }

  async execute(input: AgentExecutionInput): Promise<AttackResult> {
    const startedAt = Date.now();
    const attackCtx = readLlmAttackContext(input);
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
        logs: ["LLM Team skipped — missing llmAttack context"],
        metadata: {
          team: "llm",
          skippedReason: "missing_llm_attack_context",
          teamExecution: { llm: "skipped" },
        },
      };
    }

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
    const findingsList = result.findings?.findings ?? [];
    const platform =
      result.graph && result.status === "completed"
        ? buildLlmPlatformPayload(result)
        : null;
    const findings = findingsList.map(toAttackFinding);
    const replayPlans = findingsList.map((f) => ({
      replayPlanId: f.replayPlan.id,
      findingId: f.findingId,
      executable: f.replayPlan.executable,
      team: "llm",
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
          kind: "llm_team_summary",
          label: "LLM Team summary",
          detail: result.deferralReason ?? result.skippedReason ?? "LLM Team finished.",
          capturedAt: new Date(finishedAt).toISOString(),
          metadata: {
            llmTeamRunId: result.llmTeamRunId,
            analysisPhase: result.analysisPhase,
            executionMode: result.executionMode,
            graphNodeCount: result.graphNodeCount,
            invariantsExtracted: result.invariantsExtracted,
            attackCasesGenerated: result.attackCasesGenerated,
            specialistsCompleted: result.specialistsCompleted,
            runtimeExecutionsCompleted: result.runtimeExecutionsCompleted,
            findingsCount: result.findingsCount,
            coveragePercent: platform?.coverage.coveragePercent ?? 0,
            deferralReason: result.deferralReason ?? null,
            skippedReason: result.skippedReason ?? null,
          },
        },
      ],
      logs: [
        `LLM Team ${result.status}`,
        result.deferralReason ?? result.skippedReason ?? "",
        `analysisPhase=${result.analysisPhase}`,
        `executionMode=${result.executionMode}`,
        `findings=${findings.length}`,
      ],
      metadata: {
        team: "llm",
        llmTeamRunId: result.llmTeamRunId,
        analysisPhase: result.analysisPhase,
        executionMode: result.executionMode,
        graphNodeCount: result.graphNodeCount,
        invariantsExtracted: result.invariantsExtracted,
        attackCasesGenerated: result.attackCasesGenerated,
        specialistsCompleted: result.specialistsCompleted,
        runtimeExecutionsCompleted: result.runtimeExecutionsCompleted,
        findingsCount: result.findingsCount,
        deferralReason: result.deferralReason ?? null,
        skippedReason: result.skippedReason ?? null,
        llmPlatform: platform ?? undefined,
        llmMetrics: platform?.missionControl,
        protectedAssetSummary: platform?.protectedAssetSummary,
        attackPreconditionsSummary: platform?.attackPreconditionsSummary,
        replayPlans,
        teamExecution: { llm: execStatus },
        ueeRemediationInputs: platform?.ueeRemediationInputs,
        asoOrchestration: platform?.asoOrchestration,
        decisionExposure: platform?.decisionExposure,
        observability: platform?.observability,
      },
    };
  }
}
