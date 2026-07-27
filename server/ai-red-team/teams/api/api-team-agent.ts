import { BaseAgent, type AgentExecutionInput } from "../../agents/base-agent";
import { randomUUID } from "node:crypto";
import type { AttackResult } from "../../types";
import type { ApiTeamCoordinator } from "./api-team-coordinator";
import { toAttackFinding } from "./findings/api-finding";
import type { DiscoveryReport } from "../../discovery/types";
import type { AttackPlan } from "../../types";
import type { AttackAuthorizationRecord } from "../../authorization";

export type ApiAttackContext = {
  targetOrigin: string;
  authorization: AttackAuthorizationRecord;
  discovery: DiscoveryReport;
  plan: AttackPlan;
  redTeamRunId?: string;
};

export function readApiAttackContext(input: AgentExecutionInput): ApiAttackContext | null {
  const raw = input.context.metadata?.apiAttack;
  if (!raw || typeof raw !== "object") return null;
  const ctx = raw as ApiAttackContext;
  if (!ctx.targetOrigin || !ctx.authorization || !ctx.discovery || !ctx.plan) return null;
  return ctx;
}

export class ApiTeamAgent extends BaseAgent {
  readonly id = "surface.api";
  readonly name = "API Team";
  readonly description = "Autonomous API surface analysis and safe testing.";
  readonly priority = 40;
  readonly domain = "api" as const;
  readonly requiredCapabilities = ["api"] as const;

  constructor(private readonly coordinator: ApiTeamCoordinator) {
    super();
  }

  async canRun(context: import("../../types").ApplicationContext): Promise<boolean> {
    const caps = context.declaredCapabilities ?? [];
    if (!caps.includes("api")) return false;
    return Boolean(context.metadata?.apiAttack);
  }

  async execute(input: AgentExecutionInput): Promise<AttackResult> {
    const startedAt = Date.now();
    const attackCtx = readApiAttackContext(input);
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
        logs: ["API Team skipped — missing apiAttack context"],
      };
    }

    const result = await this.coordinator.run({
      organizationId: input.context.organizationId,
      projectId: input.context.projectId,
      runId: attackCtx.redTeamRunId ?? input.requestId,
      requestId: input.requestId,
      targetOrigin: attackCtx.targetOrigin,
      environment: attackCtx.authorization.environmentType,
      commitSha: attackCtx.authorization.commitSha,
      authorization: attackCtx.authorization,
      discoveryReport: attackCtx.discovery,
      plan: attackCtx.plan,
      signal: input.signal,
    });

    const finishedAt = Date.now();
    const findings = result.findings
      .filter((f) => f.status !== "duplicate")
      .map(toAttackFinding);

    return {
      agentId: this.id,
      agentName: this.name,
      domain: this.domain,
      status: result.status === "failed" ? "failed" : "completed",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      findings,
      evidence: [
        {
          id: randomUUID(),
          kind: "api_team_summary",
          label: "API team summary",
          detail: `${result.endpointsDiscovered} endpoints, ${result.scenariosExecuted} scenarios`,
          capturedAt: new Date(finishedAt).toISOString(),
          metadata: {
            replayPlans: result.replayPlans.length,
            safeFixCandidates: result.safeFixCandidateCount,
          },
        },
      ],
      logs: [`API Team ${result.status}`, `endpoints=${result.endpointsDiscovered}`],
      metadata: {
        apiTeamRunId: result.apiTeamRunId,
        replayPlans: result.replayPlans,
        partialReason: result.partialReason,
      },
    };
  }
}
