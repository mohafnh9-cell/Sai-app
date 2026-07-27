import { randomUUID } from "node:crypto";
import { BaseAgent, type AgentExecutionInput } from "./base-agent";
import type { AttackResult, AttackFinding } from "../types";
import type { DiscoveryReport } from "../discovery/types";
import type { AttackPlan } from "../types";
import type { AuthenticationTeam } from "../teams/authentication/authentication-team";

export type AuthenticationAttackContext = {
  discovery: DiscoveryReport;
  plan: AttackPlan;
  redTeamRunId?: string;
};

export function readAuthenticationAttackContext(input: AgentExecutionInput): AuthenticationAttackContext | null {
  const raw = input.context.metadata?.authenticationAttack;
  if (!raw || typeof raw !== "object") return null;
  const ctx = raw as AuthenticationAttackContext;
  if (!ctx.discovery || !ctx.plan) return null;
  return ctx;
}

export class AuthenticationTeamAgent extends BaseAgent {
  readonly id = "auth.authentication";
  readonly name = "Authentication Team";
  readonly description = "Discovery-driven authentication posture analysis (non-invasive).";
  readonly priority = 20;
  readonly domain = "authentication" as const;
  readonly requiredCapabilities = ["authentication"] as const;

  constructor(private readonly team: AuthenticationTeam) {
    super();
  }

  async canRun(context: import("../types").ApplicationContext): Promise<boolean> {
    const caps = context.declaredCapabilities ?? [];
    if (!caps.includes("authentication")) return false;
    return Boolean(context.metadata?.authenticationAttack ?? context.metadata?.browserAttack);
  }

  async execute(input: AgentExecutionInput): Promise<AttackResult> {
    const startedAt = Date.now();
    const attackCtx = readAuthenticationAttackContext(input);
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
        logs: ["Authentication Team skipped — missing authenticationAttack context"],
      };
    }

    const runId = attackCtx.redTeamRunId ?? input.requestId;
    const result = await this.team.run({
      runId,
      discovery: attackCtx.discovery,
      plan: attackCtx.plan,
    });

    const findings: AttackFinding[] = result.findings.map((f) => ({
      id: f.findingId,
      title: f.title,
      description: f.founderSummary,
      domain: "authentication",
      severity: f.severity,
      confidence: f.confidence,
      evidenceIds: [],
      metadata: {
        team: "authentication",
        specialist: "authentication.discovery",
        status: "candidate",
        correlationKeys: f.correlationKeys,
        safeFixEligible: f.safeFixEligible,
        remediationDirection: f.remediationDirection,
        technicalExplanation: f.technicalExplanation,
      },
    }));

    const finishedAt = Date.now();
    return {
      agentId: this.id,
      agentName: this.name,
      domain: this.domain,
      status: "completed",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      findings,
      evidence: [
        {
          id: randomUUID(),
          kind: "authentication_team_summary",
          label: "Authentication signals checked",
          detail: result.signalsChecked.join(", "),
          capturedAt: new Date(finishedAt).toISOString(),
        },
      ],
      logs: [`Authentication Team completed (${findings.length} findings)`],
      metadata: { authenticationTeamRunId: result.runId },
    };
  }
}
