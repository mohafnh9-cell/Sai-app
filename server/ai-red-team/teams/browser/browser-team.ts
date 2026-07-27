import { randomUUID } from "node:crypto";
import type { AttackPlan } from "../../types";
import type { DiscoveryReport } from "../../discovery/types";
import type { AttackAuthorizationRecord } from "../../authorization";
import { validateAttackAuthorization } from "../../authorization";
import type { BrowserSpecialistRegistry } from "./browser-agent-registry";
import type {
  BrowserTeamContext,
  BrowserTeamResult,
  BrowserTeamUserSummary,
} from "./browser-team.types";
import { DEFAULT_BROWSER_TEAM_BUDGET } from "./browser-team.config";
import { crawlSameOrigin } from "./exploration/browser-crawler";
import { mockSafeBrowserRuntimeFactory } from "./runtime/mock-browser-runtime";
import type { SafeBrowserRuntimeFactory } from "./runtime/safe-browser-runtime";
import { budgetFromAuthorization } from "./runtime/safe-browser-runtime";
import { ExecutionBudget } from "./runtime/execution-budget";
import { dedupeBrowserFindings, validateBrowserFinding } from "./validation/browser-finding-validator";
import type { BrowserFindingRecord } from "./browser-findings";
import { createRedTeamLogger } from "../../logging/red-team-logger";

export type BrowserTeamDeps = {
  registry: BrowserSpecialistRegistry;
  runtimeFactory?: SafeBrowserRuntimeFactory;
  logger?: ReturnType<typeof createRedTeamLogger>;
};

export class BrowserTeam {
  constructor(private readonly deps: BrowserTeamDeps) {}

  async run(input: {
    redTeamRunId: string;
    browserTeamRunId: string;
    organizationId: string;
    projectId: string;
    commitSha: string | null;
    targetUrl: string;
    authorization: AttackAuthorizationRecord;
    discovery: DiscoveryReport;
    plan: AttackPlan;
    signal?: AbortSignal;
  }): Promise<BrowserTeamResult> {
    const logger = this.deps.logger ?? createRedTeamLogger();
    const validation = validateAttackAuthorization(input.authorization, { targetUrl: input.targetUrl });
    if (!validation.ok) {
      throw new Error(`${validation.code}: ${validation.message}`);
    }

    const budgetLimits = {
      ...DEFAULT_BROWSER_TEAM_BUDGET,
      ...budgetFromAuthorization(input.authorization),
    };
    const budget = new ExecutionBudget(budgetLimits);
    const runtimeFactory = this.deps.runtimeFactory ?? mockSafeBrowserRuntimeFactory;

    const context: BrowserTeamContext = {
      redTeamRunId: input.redTeamRunId,
      browserTeamRunId: input.browserTeamRunId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      commitSha: input.commitSha,
      targetUrl: input.targetUrl,
      targetOrigin: input.authorization.targetOrigin,
      environmentType: input.authorization.environmentType,
      authorization: input.authorization,
      discovery: input.discovery,
      plan: input.plan,
      pathExclusions: input.authorization.pathExclusions,
      testCredentialsRef: input.authorization.testCredentialsRef,
    };

    const runtime = await runtimeFactory.create({
      targetUrl: input.targetUrl,
      authorization: input.authorization,
      budget,
      signal: input.signal,
    });

    let partialReason: string | null = null;
    const allFindings: BrowserFindingRecord[] = [];
    let scenariosExecuted = 0;

    try {
      const crawl = await crawlSameOrigin({
        runtime,
        entryPath: "/",
        budget,
        maxDepth: budgetLimits.maxDepth,
        pathExclusions: context.pathExclusions,
      });

      const specialists = this.deps.registry.listAll();
      for (const specialist of specialists) {
        if (input.signal?.aborted || budget.exhausted) break;
        const canRun = await specialist.canRun(context);
        if (!canRun) continue;
        if (!specialist.supportedEnvironments.includes(context.environmentType)) continue;

        const scenarios = await specialist.plan(context);
        for (const scenario of scenarios) {
          if (input.signal?.aborted || budget.exhausted) break;
          const result = await specialist.execute(runtime, scenario, context);
          scenariosExecuted += result.scenariosExecuted;
          allFindings.push(...result.findings);
        }
      }

      partialReason = budget.partialReason;
      const validated = dedupeBrowserFindings(allFindings.map(validateBrowserFinding));
      const confirmed = validated.filter((f) => f.status === "confirmed").length;
      const summary = buildUserSummary(validated, crawl.routesExplored, scenariosExecuted, partialReason);

      logger.log({
        event: "browser_team_completed",
        requestId: input.redTeamRunId,
        metadata: {
          browserTeamRunId: input.browserTeamRunId,
          routesExplored: crawl.routesExplored,
          scenariosExecuted,
          confirmedFindings: confirmed,
        },
      });

      return {
        browserTeamRunId: input.browserTeamRunId,
        status: partialReason ? "partially_completed" : "completed",
        routesExplored: crawl.routesExplored,
        scenariosExecuted,
        findings: validated,
        routeGraph: crawl.graph,
        summary,
        partialReason,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.log({
        event: "browser_team_failed",
        requestId: input.redTeamRunId,
        error: message,
      });
      return {
        browserTeamRunId: input.browserTeamRunId,
        status: "failed",
        routesExplored: 0,
        scenariosExecuted,
        findings: [],
        routeGraph: { nodes: [], edges: [] },
        summary: buildUserSummary([], 0, scenariosExecuted, message),
        partialReason: message,
      };
    } finally {
      await runtime.close();
    }
  }
}

function buildUserSummary(
  findings: BrowserFindingRecord[],
  routesExplored: number,
  scenariosExecuted: number,
  partialReason: string | null
): BrowserTeamUserSummary {
  const confirmed = findings.filter((f) => f.status === "confirmed");
  const highest = confirmed.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
  const coverageNotes = [
    `Routes explored: ${routesExplored}`,
    `Scenarios executed: ${scenariosExecuted}`,
  ];
  if (partialReason) coverageNotes.push(`Run stopped early: ${partialReason}`);

  return {
    status: partialReason ? "Partially completed" : "Completed",
    areasExplored: ["Public navigation", "Authentication journey", "Dashboard", "Account settings"].slice(
      0,
      Math.min(4, routesExplored)
    ),
    scenariosExecuted,
    confirmedFindings: confirmed.length,
    highestConcern: highest?.founderSummary ?? null,
    founderVerdict:
      confirmed.length > 0
        ? "I would resolve confirmed browser findings before exposing the application to real users."
        : "No confirmed browser findings in this run.",
    coverageNotes,
    recommendedNextAction: highest?.remediationDirection ?? null,
  };
}

function severityRank(severity: BrowserFindingRecord["severity"]): number {
  const order = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  return order[severity] ?? 0;
}

export function createBrowserTeam(deps: BrowserTeamDeps): BrowserTeam {
  return new BrowserTeam(deps);
}
