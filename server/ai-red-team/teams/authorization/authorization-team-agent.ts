import { BaseAgent, type AgentExecutionInput } from "../../agents/base-agent";
import { randomUUID } from "node:crypto";
import type { AttackResult, AttackPlan } from "../../types";
import type { DiscoveryReport } from "../../discovery/types";
import type { AuthorizationTeamCoordinator } from "./authorization-team-coordinator";
import { toAttackFinding } from "./findings/authorization-finding";

export type AuthorizationAttackContext = {
  discovery: DiscoveryReport;
  plan: AttackPlan;
  redTeamRunId?: string;
};

export function readAuthorizationAttackContext(input: AgentExecutionInput): AuthorizationAttackContext | null {
  const raw = input.context.metadata?.authorizationAttack;
  if (!raw || typeof raw !== "object") return null;
  const ctx = raw as AuthorizationAttackContext;
  if (!ctx.discovery || !ctx.plan) return null;
  return ctx;
}

export class AuthorizationTeamAgent extends BaseAgent {
  readonly id = "auth.authorization";
  readonly name = "Authorization Team";
  readonly description = "Authorization reasoning — roles, tenants, RLS, and privilege boundaries.";
  readonly priority = 50;
  readonly domain = "authorization" as const;
  readonly requiredCapabilities = ["authorization"] as const;

  constructor(private readonly coordinator: AuthorizationTeamCoordinator) {
    super();
  }

  async canRun(context: import("../../types").ApplicationContext): Promise<boolean> {
    const caps = context.declaredCapabilities ?? [];
    if (!caps.includes("authorization")) return false;
    return Boolean(context.metadata?.authorizationAttack);
  }

  async execute(input: AgentExecutionInput): Promise<AttackResult> {
    const startedAt = Date.now();
    const attackCtx = readAuthorizationAttackContext(input);
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
        logs: ["Authorization Team skipped — missing authorizationAttack context"],
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
          kind: "authorization_team_summary",
          label: "Authorization team summary",
          detail: `matrix=${result.matrixSize} findings=${findings.length}`,
          capturedAt: new Date(finishedAt).toISOString(),
          metadata: {
            rolesDetected: result.rolesDetected,
            resourcesDetected: result.resourcesDetected,
            replayPlans: result.replayPlans.length,
          },
        },
      ],
      logs: [
        `Authorization Team ${result.status}`,
        `roles=${result.rolesDetected} resources=${result.resourcesDetected}`,
      ],
      metadata: {
        authorizationTeamRunId: result.authorizationTeamRunId,
        authorizationGraph: result.roleGraph,
        authorizationMatrix: result.matrix,
        replayPlans: result.replayPlans,
        partialReason: result.partialReason,
      },
    };
  }
}
