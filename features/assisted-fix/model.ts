/**
 * Assisted correction panel: pure model (no React, no I/O).
 *
 * Vocabulary rule that the whole panel follows:
 *  - a PROPOSAL is documentation for the person's own agent. SequrAI has not changed any code, wrote nothing to GitHub and
 *    has verified nothing;
 *  - a VERIFIED CORRECTION exists only when the stored verification is `exact_commit_rescan_clean`: a complete rescan of exactly
 *    the commit the person reported no longer contains the finding.
 * Anything else the engine can answer is shown as NOT verified.
 */

export type FixState =
  | "PROPOSED"
  | "READY"
  | "APPROVED"
  | "APPLIED"
  | "VERIFYING"
  | "VERIFIED"
  | "FAILED"
  | "SUPERSEDED";

export type VerificationStatement = "exact_commit_rescan_clean" | "later_analysis_clean_unbound" | "not_verified";

export type PanelAnalysis = {
  scanId: string;
  commitSha: string | null;
  branch: string | null;
  completedAt: string | null;
};

export type PanelVerification = {
  statement: VerificationStatement;
  outcome: "passed" | "failed" | "partial";
  verifiedCommitSha: string | null;
  verifiedAnalysis: PanelAnalysis | null;
  reasons: string[];
  verifiedAt: string;
  /** The commit this verification was made for (the proposal's reported commit at the time); null for older rows that lack it. */
  commitSha?: string | null;
};

export type PanelFix = {
  id: string;
  recommendationId: string;
  title: string;
  severity: string | null;
  state: FixState;
  createdAt: string;
  updatedAt: string;
  /** The analysis the proposal was generated from (rama, commit, fecha). */
  baseAnalysis: PanelAnalysis | null;
  /** The commit the person reported as containing the correction (null until `applied`). */
  reportedCommitSha: string | null;
  /** The copyable instructions for the person's agent. */
  instructions: string;
  filesToChange: string[];
  verification: PanelVerification | null;
};

export type PanelSuggestion = {
  branch: string | null;
  commitSha: string;
  detectedAt: string | null;
  /** The latest completed analysis of exactly this commit, if one exists. */
  analysis: PanelAnalysis | null;
};

export type PanelData = {
  projectId: string;
  fixes: PanelFix[];
  suggestion: PanelSuggestion | null;
  /** Completed analyses of this project by commit, used to show rama/análisis for a commit the person types. */
  knownAnalyses: PanelAnalysis[];
};

export type PanelPhase =
  | "proposal" // PROPOSED / READY: documentary, nothing done
  | "approved" // waiting for the person to report the commit
  | "applied" // commit reported, not verified yet
  | "verifying"
  | "verified" // ONLY exact_commit_rescan_clean
  | "not_verified" // FAILED, or VERIFIED without an exact-commit statement
  | "updating" // the state and the evidence shown disagree (e.g. VERIFIED but only an older failed verification is loaded): say nothing about the result yet
  | "historical"; // SUPERSEDED

export function isFullSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value.trim());
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "—";
}

/**
 * Is the evidence we hold the evidence of the state we show? A card must never combine a state with another attempt's evidence:
 *  - VERIFIED needs a PASSED verification; FAILED must not carry a passed one;
 *  - the verification must belong to the commit currently reported (when the row says which commit it was made for).
 */
export function isEvidenceCoherent(fix: Pick<PanelFix, "state" | "verification" | "reportedCommitSha">): boolean {
  const verification = fix.verification;
  if (fix.state === "VERIFIED") {
    if (!verification || verification.outcome !== "passed") return false;
  } else if (fix.state === "FAILED") {
    if (!verification) return true; // nothing to contradict: shown as not verified, without reasons
    if (verification.outcome === "passed") return false;
  } else {
    return true;
  }
  if (verification && verification.commitSha && fix.reportedCommitSha) {
    return verification.commitSha.toLowerCase() === fix.reportedCommitSha.toLowerCase();
  }
  return true;
}

export function phaseOf(fix: Pick<PanelFix, "state" | "verification" | "reportedCommitSha">): PanelPhase {
  switch (fix.state) {
    case "PROPOSED":
    case "READY":
      return "proposal";
    case "APPROVED":
      return "approved";
    case "APPLIED":
      return "applied";
    case "VERIFYING":
      return "verifying";
    case "VERIFIED":
      if (!isEvidenceCoherent(fix)) return "updating";
      // A VERIFIED record without an exact-commit statement is never presented as a verified correction.
      return fix.verification?.statement === "exact_commit_rescan_clean" ? "verified" : "not_verified";
    case "FAILED":
      return isEvidenceCoherent(fix) ? "not_verified" : "updating";
    case "SUPERSEDED":
      return "historical";
  }
}

/** The verification statement derivable from what the engine persists (the row stores outcome + binding, not the statement). */
export function statementFromPersisted(input: {
  outcome: "passed" | "failed" | "partial";
  binding: "exact_proposal_commit" | "assisted_unbound" | string | null;
}): VerificationStatement {
  if (input.outcome !== "passed") return "not_verified";
  return input.binding === "exact_proposal_commit" ? "exact_commit_rescan_clean" : "later_analysis_clean_unbound";
}

// ---------------------------------------------------------------------------------------------------------------------
// Reporting the commit: nothing is preselected; the person must confirm sha, branch and analysis.

export type CommitCheck =
  | { ok: false; reason: "empty" | "not_full_sha" | "same_as_base" }
  | {
      ok: true;
      commitSha: string; // normalized to lowercase
      /** The analysis SequrAI already has for exactly this commit, if any. */
      analysis: PanelAnalysis | null;
      /** Rama taken from that analysis; null = unknown until the commit is analysed. */
      branch: string | null;
      /** True when the commit equals the suggestion shown by the panel (still requires explicit confirmation). */
      isSuggestion: boolean;
    };

export function checkCommitInput(input: {
  value: string;
  fix: Pick<PanelFix, "baseAnalysis">;
  suggestion: PanelSuggestion | null;
  knownAnalyses: PanelAnalysis[];
}): CommitCheck {
  const raw = input.value.trim();
  if (raw === "") return { ok: false, reason: "empty" };
  if (!isFullSha(raw)) return { ok: false, reason: "not_full_sha" };
  const commitSha = raw.toLowerCase();
  if (input.fix.baseAnalysis?.commitSha && input.fix.baseAnalysis.commitSha.toLowerCase() === commitSha) {
    return { ok: false, reason: "same_as_base" };
  }
  const analysis =
    (input.suggestion && input.suggestion.commitSha.toLowerCase() === commitSha ? input.suggestion.analysis : null) ??
    input.knownAnalyses.find((a) => a.commitSha?.toLowerCase() === commitSha) ??
    null;
  return {
    ok: true,
    commitSha,
    analysis,
    branch: analysis?.branch ?? (input.suggestion?.commitSha.toLowerCase() === commitSha ? input.suggestion.branch : null),
    isSuggestion: input.suggestion?.commitSha.toLowerCase() === commitSha,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Errors returned by the existing routes -> a stable key the interface translates (never a raw server string).

export type PanelErrorKey =
  | "not_found"
  | "open_fix_exists"
  | "in_flight"
  | "invalid_state"
  | "commit_is_base"
  | "commit_locked"
  | "commit_conflict"
  | "unsupported"
  | "invalid_commit"
  | "unavailable"
  | "forbidden"
  | "unknown";

export function errorKeyFor(input: { status: number; code?: string | null }): PanelErrorKey {
  const code = input.code ?? "";
  if (input.status === 404) return "not_found";
  if (input.status === 401 || input.status === 403) return "forbidden";
  if (code === "open_fix_exists") return "open_fix_exists";
  if (code === "in_flight") return "in_flight";
  if (code === "proposal_commit_is_base_commit") return "commit_is_base";
  if (code === "proposal_commit_locked") return "commit_locked";
  if (code === "proposal_commit_conflict") return "commit_conflict";
  if (code === "proposal_commit_unsupported") return "unsupported";
  if (code.startsWith("invalid_transition")) return "invalid_state";
  if (input.status === 400) return "invalid_commit";
  if (input.status === 503 || input.status >= 500) return "unavailable";
  if (input.status === 409) return "invalid_state";
  return "unknown";
}
