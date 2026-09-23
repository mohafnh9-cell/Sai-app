import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { targetsStillPresent, type TargetFinding } from "./finding-identity";

/**
 * Pure decision rules for "was this specific finding actually fixed?".
 *
 * A fix is VERIFIED only when the exact target finding(s) are absent from a
 * complete, valid rescan of the same project and repository. Score, blocker
 * counts, finding counts, titles, recommendations and alerts are secondary
 * evidence only and can never independently produce VERIFIED.
 */

export type ScanFacts = {
  id: string;
  status: string | null;
  createdAt: string | null;
  commitSha: string | null;
  branch: string | null;
  projectId: string | null;
  repositoryId: string | null;
  organizationId: string | null;
};

export type VerificationReason =
  | "verification_scan_missing"
  | "baseline_scan_missing"
  | "wrong_project"
  | "wrong_repository"
  | "wrong_organization"
  | "verification_scan_is_baseline"
  | "verification_scan_not_newer"
  | "scan_not_completed"
  | "commit_unknown"
  | "same_commit"
  | "branch_mismatch"
  | "verdict_missing"
  | "verdict_scan_mismatch"
  | "insufficient_coverage"
  | "partial_scan"
  | "engine_incomplete"
  | "rule_failures"
  | "no_target_identity"
  | "findings_unavailable"
  | "target_still_present"
  | "conflicting_dynamic_evidence";

export type VerificationEvidence = {
  projectId: string;
  organizationId: string;
  baselineScan: ScanFacts | null;
  verificationScan: ScanFacts | null;
  /** The persisted verdict generated from the verification scan, if any. */
  verdict: ProductionVerdictV1 | null;
  externalEngineIncomplete: boolean;
  nativeRuleCoverageIncomplete: boolean;
  /** Targets resolved from the baseline; empty/unresolved means identity cannot be established. */
  targets: readonly TargetFinding[];
  targetsFullyResolved: boolean;
  /** Identity keys of every finding in the rescan; null when they could not be loaded. */
  rescanKeys: ReadonlySet<string> | null;
};

export type VerificationDecision = {
  outcome: "passed" | "failed" | "partial";
  reasons: VerificationReason[];
  /** Target finding ids still present in the rescan. */
  remainingTargetIds: string[];
  /** True only when every target is provably absent from a loaded rescan. */
  targetsAbsent: boolean;
};

function timeOf(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Gates that establish the rescan is a valid rescan of the same project/repository lineage. */
function identityReasons(evidence: VerificationEvidence): VerificationReason[] {
  const reasons: VerificationReason[] = [];
  const { baselineScan: baseline, verificationScan: rescan } = evidence;

  if (!baseline) reasons.push("baseline_scan_missing");
  if (!rescan) {
    reasons.push("verification_scan_missing");
    return reasons;
  }

  if (rescan.projectId !== evidence.projectId) reasons.push("wrong_project");
  if (rescan.repositoryId !== evidence.projectId) reasons.push("wrong_repository");
  if (rescan.organizationId !== evidence.organizationId) reasons.push("wrong_organization");
  if (!baseline) return reasons;

  if (rescan.id === baseline.id) {
    reasons.push("verification_scan_is_baseline");
    return reasons;
  }

  const rescanTime = timeOf(rescan.createdAt);
  const baselineTime = timeOf(baseline.createdAt);
  if (rescanTime == null || baselineTime == null || rescanTime <= baselineTime) {
    reasons.push("verification_scan_not_newer");
  }

  if (!rescan.commitSha || !baseline.commitSha) {
    reasons.push("commit_unknown");
  } else if (rescan.commitSha === baseline.commitSha) {
    // Same code cannot have fixed anything.
    reasons.push("same_commit");
  }

  if (baseline.branch && rescan.branch && baseline.branch !== rescan.branch) {
    reasons.push("branch_mismatch");
  }
  return reasons;
}

/** Gates that establish the rescan's evidence is complete enough to trust an absence. */
function completenessReasons(evidence: VerificationEvidence): VerificationReason[] {
  const reasons: VerificationReason[] = [];
  const { verificationScan: rescan, verdict } = evidence;

  if (rescan?.status !== "completed") reasons.push("scan_not_completed");

  if (!verdict) {
    reasons.push("verdict_missing");
  } else if (verdict.scanId !== rescan?.id) {
    reasons.push("verdict_scan_mismatch");
  } else if (verdict.status === "analysis_failed") {
    reasons.push("partial_scan");
  } else if (verdict.status === "insufficient_data") {
    // The canonical verdict engine already folds coverage floor, partial scans,
    // failed engines and native rule failures into insufficient_data; the
    // specific causes are reported when they can be identified.
    if (evidence.externalEngineIncomplete) reasons.push("engine_incomplete");
    if (evidence.nativeRuleCoverageIncomplete) reasons.push("rule_failures");
    if (!evidence.externalEngineIncomplete && !evidence.nativeRuleCoverageIncomplete) {
      reasons.push("insufficient_coverage");
    }
  }

  // Independent of the verdict's own status: never trust an absence from a
  // rescan whose engines are known to be incomplete.
  if (verdict && evidence.externalEngineIncomplete && !reasons.includes("engine_incomplete")) {
    reasons.push("engine_incomplete");
  }
  if (verdict && evidence.nativeRuleCoverageIncomplete && !reasons.includes("rule_failures")) {
    reasons.push("rule_failures");
  }

  if ((verdict?.attackSimulation?.stillVulnerableExecutions ?? 0) > 0) {
    reasons.push("conflicting_dynamic_evidence");
  }
  return reasons;
}

export function decideFindingVerification(evidence: VerificationEvidence): VerificationDecision {
  const identity = identityReasons(evidence);

  if (evidence.targets.length === 0 || !evidence.targetsFullyResolved) {
    identity.push("no_target_identity");
  }
  if (evidence.rescanKeys == null) identity.push("findings_unavailable");

  // A rescan of the wrong project/repository/scan, or with no identifiable
  // target, proves nothing either way.
  if (identity.length > 0) {
    return { outcome: "partial", reasons: identity, remainingTargetIds: [], targetsAbsent: false };
  }

  const remaining = targetsStillPresent(evidence.targets, evidence.rescanKeys as ReadonlySet<string>);
  if (remaining.length > 0) {
    return {
      outcome: "failed",
      reasons: ["target_still_present"],
      remainingTargetIds: remaining.map((target) => target.findingId),
      targetsAbsent: false,
    };
  }

  const completeness = completenessReasons(evidence);
  if (completeness.includes("conflicting_dynamic_evidence") && completeness.length === 1) {
    return { outcome: "failed", reasons: completeness, remainingTargetIds: [], targetsAbsent: true };
  }
  if (completeness.length > 0) {
    return { outcome: "partial", reasons: completeness, remainingTargetIds: [], targetsAbsent: true };
  }

  return { outcome: "passed", reasons: [], remainingTargetIds: [], targetsAbsent: true };
}
