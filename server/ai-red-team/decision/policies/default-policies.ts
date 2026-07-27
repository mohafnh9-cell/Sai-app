import type { DecisionPolicy } from "../decision-policy";
import type { SecurityIntelligenceReport } from "../../intelligence/models";
import type { DecisionContext } from "../decision-context";

export const confirmedDeployBlockerPolicy: DecisionPolicy = {
  id: "gate.confirmed_deploy_blocker",
  description: "Block when confirmed high-severity remediation is required before production.",
  evaluate({ intelligence }) {
    const blockers = intelligence.priorities.filter(
      (p) => p.priority === "fix_immediately" || p.priority === "fix_before_production"
    );
    const high = intelligence.deduplicatedFindings.filter(
      (f) => f.severity === "high" || f.severity === "critical"
    );
    const triggered = blockers.length > 0 || high.length > 0;
    return {
      policyId: "gate.confirmed_deploy_blocker",
      triggered,
      effect: triggered ? "BLOCK_DEPLOYMENT" : null,
      block: triggered,
      requireVerification: false,
      insufficientEvidence: false,
      rationale: triggered
        ? "Confirmed or high-severity findings require resolution before deployment."
        : "No confirmed deploy blockers in intelligence report.",
      evidenceUsed: blockers.map((b) => b.findingId),
      evidenceMissing: [],
    };
  },
};

export const replayFailedPolicy: DecisionPolicy = {
  id: "gate.replay_failed",
  description: "Block when latest replay failed.",
  evaluate({ context }) {
    const triggered = context.replayStatus === "failed";
    return {
      policyId: "gate.replay_failed",
      triggered,
      effect: triggered ? "BLOCK_DEPLOYMENT" : null,
      block: triggered,
      requireVerification: false,
      insufficientEvidence: false,
      rationale: triggered ? "Latest replay verification failed." : "Replay did not fail.",
      evidenceUsed: triggered ? ["replay_status:failed"] : [],
      evidenceMissing: context.replayStatus === "not_run" ? ["replay_verification"] : [],
    };
  },
};

export const safeFixPendingPolicy: DecisionPolicy = {
  id: "gate.safe_fix_pending",
  description: "Block when critical Safe Fix is pending verification.",
  evaluate({ context }) {
    const triggered = context.safeFixStatus === "pending";
    return {
      policyId: "gate.safe_fix_pending",
      triggered,
      effect: triggered ? "REQUIRES_VERIFICATION" : null,
      block: false,
      requireVerification: triggered,
      insufficientEvidence: false,
      rationale: triggered ? "Safe Fix is pending verification." : "No pending Safe Fix gate.",
      evidenceUsed: triggered ? ["safe_fix:pending"] : [],
      evidenceMissing: [],
    };
  },
};

export const redTeamRunIncompletePolicy: DecisionPolicy = {
  id: "gate.red_team_incomplete",
  description: "Do not approve on stale or incomplete authorized attack run.",
  evaluate({ context }) {
    const triggered =
      context.redTeamRunStatus === "queued" ||
      context.redTeamRunStatus === "running" ||
      context.redTeamRunStatus === "failed";
    return {
      policyId: "gate.red_team_incomplete",
      triggered,
      effect: triggered ? "INSUFFICIENT_EVIDENCE" : null,
      block: context.redTeamRunStatus === "failed",
      requireVerification: context.redTeamRunStatus === "queued" || context.redTeamRunStatus === "running",
      insufficientEvidence: triggered,
      rationale: triggered
        ? `Authorized attack run status: ${context.redTeamRunStatus}`
        : "Attack run is complete or not required.",
      evidenceUsed: triggered ? [`red_team_run:${context.redTeamRunStatus}`] : [],
      evidenceMissing:
        context.redTeamRunStatus === "none" ? ["authorized_attack_simulation"] : [],
    };
  },
};

export const commitMismatchPolicy: DecisionPolicy = {
  id: "gate.commit_mismatch",
  description: "Evidence must match target commit.",
  evaluate({ context, intelligence }) {
    const intelCommit = intelligence.deduplicatedFindings.length > 0 ? context.commitSha : context.commitSha;
    const evidenceSha = context.evidenceCommitSha ?? context.commitSha;
    const triggered = Boolean(
      context.commitSha && evidenceSha && context.commitSha !== evidenceSha
    );
    return {
      policyId: "gate.commit_mismatch",
      triggered,
      effect: triggered ? "INSUFFICIENT_EVIDENCE" : null,
      block: false,
      requireVerification: triggered,
      insufficientEvidence: triggered,
      rationale: triggered
        ? "Security evidence belongs to a different commit than the deployment target."
        : "Evidence commit aligns with deployment commit.",
      evidenceUsed: triggered ? [`commit:${evidenceSha}`] : [],
      evidenceMissing: triggered ? [`commit:${context.commitSha}`] : [],
    };
  },
};

export const coverageThresholdPolicy: DecisionPolicy = {
  id: "gate.coverage_threshold",
  description: "Require minimum coverage score for production deployment.",
  evaluate({ context, intelligence }) {
    const min = context.minCoverageScore ?? 0.35;
    const browserRan = intelligence.verdict.coverage.some((c) => c.includes("Browser"));
    const scoreEstimate = browserRan ? 0.55 : intelligence.deduplicatedFindings.length > 0 ? 0.45 : 0.2;
    const triggered =
      context.deploymentEnvironment === "production" && scoreEstimate < min;
    return {
      policyId: "gate.coverage_threshold",
      triggered,
      effect: triggered ? "REQUIRES_VERIFICATION" : null,
      block: false,
      requireVerification: triggered,
      insufficientEvidence: false,
      rationale: triggered
        ? `Coverage below threshold for production (${scoreEstimate} < ${min}).`
        : "Coverage threshold satisfied or non-production environment.",
      evidenceUsed: intelligence.verdict.coverage,
      evidenceMissing: triggered ? ["authenticated_coverage", "admin_coverage"] : [],
    };
  },
};

export const regressionPolicy: DecisionPolicy = {
  id: "policy.memory_regression",
  description: "Increase scrutiny when memory indicates regression.",
  evaluate({ intelligence }) {
    const regressed = intelligence.memoryLinks.some((m) => m.regressed);
    return {
      policyId: "policy.memory_regression",
      triggered: regressed,
      effect: regressed ? "APPROVE_WITH_WARNINGS" : null,
      block: false,
      requireVerification: regressed,
      insufficientEvidence: false,
      rationale: regressed
        ? "Production Memory suggests a previously addressed issue may have regressed."
        : "No regression signal in memory.",
      evidenceUsed: intelligence.memoryLinks.filter((m) => m.regressed).map((m) => m.findingId),
      evidenceMissing: [],
    };
  },
};

export const authorizationDeployBlockerPolicy: DecisionPolicy = {
  id: "gate.authorization_critical",
  description: "Block on confirmed authorization failures (tenant isolation, privilege escalation, broken admin auth).",
  evaluate({ intelligence }) {
    const authz = intelligence.deduplicatedFindings.filter(
      (f) =>
        f.domain === "authorization" &&
        (f.severity === "critical" || f.severity === "high") &&
        /tenant_isolation|privilege_escalation|broken_function|broken_rls|broken_object/i.test(
          String(f.metadata?.category ?? f.title)
        )
    );
    const triggered = authz.length > 0;
    return {
      policyId: "gate.authorization_critical",
      triggered,
      effect: triggered ? "BLOCK_DEPLOYMENT" : null,
      block: triggered,
      requireVerification: false,
      insufficientEvidence: false,
      rationale: triggered
        ? "Confirmed authorization boundary failures require remediation before deployment."
        : "No critical authorization deploy blockers detected.",
      evidenceUsed: authz.map((f) => f.id),
      evidenceMissing: [],
    };
  },
};

export function createDefaultDecisionPolicies(): DecisionPolicy[] {
  return [
    confirmedDeployBlockerPolicy,
    authorizationDeployBlockerPolicy,
    replayFailedPolicy,
    safeFixPendingPolicy,
    redTeamRunIncompletePolicy,
    commitMismatchPolicy,
    coverageThresholdPolicy,
    regressionPolicy,
  ];
}
