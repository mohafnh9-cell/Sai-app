import { randomUUID } from "node:crypto";
import { BaseAgent, type AgentExecutionInput } from "./base-agent";
import type { AttackResult } from "../types";
import type { DiscoveryReport } from "../discovery/types";
import type { AttackAuthorizationRecord } from "../authorization";
import type { AttackPlan } from "../types";
import type { BrowserTeam } from "../teams/browser/browser-team";
import { toAttackFinding } from "../teams/browser/browser-findings";

export type BrowserAttackContext = {
  targetUrl: string;
  authorization: AttackAuthorizationRecord;
  discovery: DiscoveryReport;
  plan: AttackPlan;
  redTeamRunId?: string;
  browserTeamRunId?: string;
};

export function readBrowserAttackContext(
  input: AgentExecutionInput
): BrowserAttackContext | null {
  const raw = input.context.metadata?.browserAttack;
  if (!raw || typeof raw !== "object") return null;
  const ctx = raw as BrowserAttackContext;
  if (!ctx.targetUrl || !ctx.authorization || !ctx.discovery || !ctx.plan) return null;
  return ctx;
}

export class BrowserTeamAgent extends BaseAgent {
  readonly id = "surface.browser";
  readonly name = "Browser Team";
  readonly description = "Autonomous browser security simulation team.";
  readonly priority = 30;
  readonly domain = "browser" as const;
  readonly requiredCapabilities = ["browser"] as const;

  constructor(private readonly browserTeam: BrowserTeam) {
    super();
  }

  async canRun(context: import("../types").ApplicationContext): Promise<boolean> {
    const caps = context.declaredCapabilities ?? [];
    if (!caps.includes("browser")) return false;
    return Boolean(context.metadata?.browserAttack);
  }

  async execute(input: AgentExecutionInput): Promise<AttackResult> {
    const startedAt = Date.now();
    const attackCtx = readBrowserAttackContext(input);
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
        logs: ["Browser Team skipped — missing authorized browserAttack context"],
      };
    }

    const redTeamRunId = attackCtx.redTeamRunId ?? input.requestId;
    const browserTeamRunId = attackCtx.browserTeamRunId ?? randomUUID();

    const result = await this.browserTeam.run({
      redTeamRunId,
      browserTeamRunId,
      organizationId: input.context.organizationId,
      projectId: input.context.projectId,
      commitSha: attackCtx.authorization.commitSha,
      targetUrl: attackCtx.targetUrl,
      authorization: attackCtx.authorization,
      discovery: attackCtx.discovery,
      plan: attackCtx.plan,
      signal: input.signal,
    });

    const finishedAt = Date.now();
    const findings = result.findings
      .filter((f) => f.status !== "duplicate" && f.status !== "rejected")
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
          kind: "browser_team_summary",
          label: "Browser simulation summary",
          detail: result.summary.highestConcern,
          capturedAt: new Date(finishedAt).toISOString(),
          metadata: {
            status: result.status,
            routesExplored: result.routesExplored,
            scenariosExecuted: result.scenariosExecuted,
            coverageNotes: result.summary.coverageNotes,
          },
        },
      ],
      logs: [
        `Browser Team ${result.status}`,
        `routes=${result.routesExplored} scenarios=${result.scenariosExecuted}`,
      ],
      metadata: {
        browserTeamRunId: result.browserTeamRunId,
        partialReason: result.partialReason,
        routeGraph: result.routeGraph,
      },
    };
  }
}
