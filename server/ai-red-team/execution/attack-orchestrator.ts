import type { AgentRegistry } from "../agents/registry";
import type { ApplicationContext, AttackPlan, AttackRunOptions } from "../types";
import type { AttackExecution, AttackResult, AttackSummary } from "../types";
import type { RedTeamLogger } from "../logging/red-team-logger";
import { AttackRunner, createAttackRunner } from "./attack-runner";

export type OrchestratorInput = {
  requestId: string;
  context: ApplicationContext;
  plan: AttackPlan;
  registry: AgentRegistry;
  options?: AttackRunOptions;
  logger?: RedTeamLogger;
};

export type OrchestratorOutput = {
  results: AttackResult[];
  executions: AttackExecution[];
  summary: AttackSummary;
};

export class AttackOrchestrator {
  constructor(private readonly runner: AttackRunner = createAttackRunner()) {}

  async execute(input: OrchestratorInput): Promise<OrchestratorOutput> {
    const logger = input.logger;
    const signal = input.options?.signal;
    const maxParallel = Math.max(1, input.options?.maxParallel ?? 4);
    const runner =
      input.options?.timeoutMs != null || input.options?.maxRetries != null
        ? createAttackRunner({
            timeoutMs: input.options?.timeoutMs,
            maxRetries: input.options?.maxRetries,
            logger,
          })
        : this.runner;

    const plan = await this.assignAgentsToPlan(input.plan, input.registry, input.context, logger);
    const phaseOrder = this.resolvePhaseOrder(plan);
    const results: AttackResult[] = [];
    const executions: AttackExecution[] = [];
    const started = Date.now();

    for (const phaseId of phaseOrder) {
      if (signal?.aborted) break;
      const phase = plan.phases.find((p) => p.id === phaseId);
      if (!phase) continue;

      const agents = phase.agentIds
        .map((id) => input.registry.getById(id))
        .filter((agent): agent is NonNullable<typeof agent> => agent != null);

      await this.runPhaseInParallel({
        requestId: input.requestId,
        phaseId: phase.id,
        domain: phase.domain,
        agents,
        context: input.context,
        maxParallel,
        signal,
        runner,
        results,
        executions,
      });
    }

    const summary = buildAttackSummary(results, Date.now() - started);
    logger?.log({
      event: "orchestration_completed",
      requestId: input.requestId,
      planId: plan.planId,
      durationMs: summary.totalDurationMs,
      metadata: { completed: summary.completed, failed: summary.failed },
    });

    return { results, executions, summary };
  }

  private async assignAgentsToPlan(
    plan: AttackPlan,
    registry: AgentRegistry,
    context: ApplicationContext,
    logger?: RedTeamLogger
  ): Promise<AttackPlan> {
    const phases = [];
    for (const phase of plan.phases) {
      const agents = await registry.listAvailableForDomain(context, phase.domain);
      const agentIds = agents.map((agent) => agent.id);
      phases.push({ ...phase, agentIds });
    }
    const assigned = { ...plan, phases };
    logger?.log({
      event: "agents_selected",
      planId: plan.planId,
      metadata: {
        phases: assigned.phases.map((p) => ({ id: p.id, agentIds: p.agentIds })),
      },
    });
    return assigned;
  }

  private resolvePhaseOrder(plan: AttackPlan): string[] {
    const ids = plan.phases.map((p) => p.id);
    const deps = new Map(plan.phases.map((p) => [p.id, p.dependsOn ?? []]));
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const dep of deps.get(id) ?? []) {
        if (ids.includes(dep)) visit(dep);
      }
      order.push(id);
    };

    for (const id of ids) visit(id);
    return order;
  }

  private async runPhaseInParallel(input: {
    requestId: string;
    phaseId: string;
    domain: AttackPlan["phases"][number]["domain"];
    agents: NonNullable<ReturnType<AgentRegistry["getById"]>>[];
    context: ApplicationContext;
    maxParallel: number;
    signal?: AbortSignal;
    runner: AttackRunner;
    results: AttackResult[];
    executions: AttackExecution[];
  }): Promise<void> {
    const queue = [...input.agents];
    const workers: Promise<void>[] = [];

    const worker = async () => {
      while (queue.length > 0) {
        if (input.signal?.aborted) return;
        const agent = queue.shift();
        if (!agent) return;
        const { execution, result } = await input.runner.runAgent({
          requestId: input.requestId,
          planPhaseId: input.phaseId,
          agent,
          executionInput: {
            requestId: input.requestId,
            context: input.context,
            domain: input.domain,
            signal: input.signal,
          },
          signal: input.signal,
        });
        input.executions.push(execution);
        input.results.push(result);
      }
    };

    for (let i = 0; i < Math.min(input.maxParallel, input.agents.length || 1); i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }
}

export function buildAttackSummary(results: AttackResult[], totalDurationMs: number): AttackSummary {
  const domainsCovered = [...new Set(results.map((r) => r.domain))];
  return {
    totalAgents: results.length,
    completed: results.filter((r) => r.status === "completed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    cancelled: results.filter((r) => r.status === "cancelled").length,
    timedOut: results.filter((r) => r.status === "timed_out").length,
    totalFindings: results.reduce((sum, r) => sum + r.findings.length, 0),
    totalDurationMs,
    domainsCovered,
  };
}

export function createAttackOrchestrator(runner?: AttackRunner): AttackOrchestrator {
  return new AttackOrchestrator(runner);
}
