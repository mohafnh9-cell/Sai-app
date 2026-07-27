import type { RedTeamReport } from "../types";
import type { AttackResult } from "../types";

export type TraceabilityIssue = {
  stage: string;
  code: string;
  message: string;
};

export type TraceabilityReport = {
  ok: boolean;
  issues: TraceabilityIssue[];
  anchors: {
    requestId: string;
    discoveryReportId: string;
    commitSha: string;
    executionIds: string[];
    correlationKeys: string[];
  };
};

function push(issues: TraceabilityIssue[], stage: string, code: string, message: string): void {
  issues.push({ stage, code, message });
}

/** Validates cross-stage anchors on a director report (E2E traceability gate). */
export function auditPlatformTraceability(report: RedTeamReport): TraceabilityReport {
  const issues: TraceabilityIssue[] = [];
  const requestId = report.requestId;
  const discoveryReportId = report.discovery.reportId;
  const commitSha = report.discovery.commitSha;

  if (!requestId) push(issues, "director", "missing_request_id", "requestId is required.");
  if (!discoveryReportId) push(issues, "discovery", "missing_discovery_id", "discovery.reportId is required.");
  if (!commitSha) push(issues, "discovery", "missing_commit", "discovery.commitSha is required.");

  const executionIds = report.executions.map((e) => e.executionId).filter(Boolean);
  if (executionIds.length === 0) {
    push(issues, "runtime", "missing_executions", "At least one agent execution record is expected.");
  }

  const rt9 = report.results.find((r) => r.agentId === "logic.business");
  const rt10 = report.results.find((r) => r.agentId === "ai.llm");

  auditTeamResult(rt9, "RT9", requestId, issues);
  auditTeamResult(rt10, "RT10", requestId, issues);

  if (report.intelligence) {
    if (!report.intelligence.reportId) {
      push(issues, "intelligence", "missing_report_id", "Intelligence reportId missing.");
    }
  } else {
    push(issues, "intelligence", "missing_intelligence", "Intelligence block missing.");
  }

  if (!report.securityDecision?.decision.decisionId) {
    push(issues, "decision", "missing_decision_id", "Security decision id missing.");
  }
  if (!report.productionVerdict?.status) {
    push(issues, "production_verdict", "missing_verdict", "Production verdict missing.");
  }

  const correlationKeys = [
    ...new Set(
      (report.intelligence?.correlations ?? []).flatMap((c) =>
        "findingIds" in c && Array.isArray(c.findingIds) ? c.findingIds : []
      )
    ),
  ].sort();

  for (const result of report.results) {
    for (const finding of result.findings) {
      if (!finding.id) push(issues, "finding", "missing_finding_id", `Finding missing id (${result.agentId}).`);
      if (!finding.metadata || typeof finding.metadata !== "object") {
        push(issues, "finding", "missing_metadata", `Finding ${finding.id} missing metadata.`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues: issues.sort((a, b) => `${a.stage}:${a.code}`.localeCompare(`${b.stage}:${b.code}`)),
    anchors: {
      requestId,
      discoveryReportId,
      commitSha,
      executionIds: [...new Set(executionIds)].sort(),
      correlationKeys,
    },
  };
}

function auditTeamResult(
  result: AttackResult | undefined,
  label: string,
  requestId: string,
  issues: TraceabilityIssue[]
): void {
  if (!result) return;
  if (result.status === "skipped") return;
  const runId =
    (result.metadata?.businessLogicTeamRunId as string | undefined) ??
    (result.metadata?.llmTeamRunId as string | undefined);
  if (!runId) {
    push(issues, label, "missing_team_run_id", `${label} result missing team run id metadata.`);
  }
  const platform =
    result.metadata?.businessLogicPlatform ?? result.metadata?.llmPlatform ?? result.metadata?.llmMetrics;
  if (!platform) {
    push(issues, label, "missing_platform_payload", `${label} missing platform integration metadata.`);
  }
  if (result.metadata?.teamExecution == null) {
    push(issues, label, "missing_team_execution", `${label} missing teamExecution status.`);
  }
  if (requestId && result.logs.every((l) => !l.includes(requestId)) && result.findings.length === 0) {
    // non-fatal — requestId may only appear on executions
  }
}

export function extractMissionControlInputs(report: RedTeamReport): {
  businessLogicMetrics: unknown;
  llmMetrics: unknown;
  teamExecution: Record<string, string>;
} {
  const teamExecution: Record<string, string> = {};
  let businessLogicMetrics: unknown;
  let llmMetrics: unknown;

  for (const result of report.results) {
    if (result.metadata?.teamExecution && typeof result.metadata.teamExecution === "object") {
      Object.assign(teamExecution, result.metadata.teamExecution as Record<string, string>);
    }
    if (result.metadata?.businessLogicMetrics) businessLogicMetrics = result.metadata.businessLogicMetrics;
    if (result.metadata?.llmMetrics) llmMetrics = result.metadata.llmMetrics;
  }

  return { businessLogicMetrics, llmMetrics, teamExecution };
}
