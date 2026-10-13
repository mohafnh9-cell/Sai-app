import { describe, expect, it } from "vitest";
import { checkCommitInput, errorKeyFor, isFullSha, phaseOf, shortSha, statementFromPersisted, type PanelAnalysis, type PanelFix, type PanelSuggestion } from "../model";

const BASE = "a".repeat(40);
const OTHER = "b".repeat(40);
const analysis = (sha: string, branch = "main"): PanelAnalysis => ({ scanId: "s-" + sha.slice(0, 4), commitSha: sha, branch, completedAt: "2026-10-09T10:00:00.000Z" });
const fix = (state: PanelFix["state"], over: Partial<PanelFix> = {}): PanelFix => ({
  id: "f1", recommendationId: "priority-1", title: "t", severity: null, state, createdAt: "", updatedAt: "", baseAnalysis: analysis(BASE), reportedCommitSha: null, instructions: "", filesToChange: [], verification: null, ...over,
});
const verification = (statement: "exact_commit_rescan_clean" | "later_analysis_clean_unbound" | "not_verified") => ({
  statement, outcome: statement === "not_verified" ? ("failed" as const) : ("passed" as const), verifiedCommitSha: OTHER, verifiedAnalysis: null, reasons: [], verifiedAt: "",
});

describe("phases: a proposal is not a correction; only an exact-commit verification is", () => {
  it("documentary and in-progress states never read as verified", () => {
    expect(phaseOf(fix("PROPOSED"))).toBe("proposal");
    expect(phaseOf(fix("READY"))).toBe("proposal");
    expect(phaseOf(fix("APPROVED"))).toBe("approved");
    expect(phaseOf(fix("APPLIED"))).toBe("applied");
    expect(phaseOf(fix("VERIFYING"))).toBe("verifying");
    expect(phaseOf(fix("SUPERSEDED"))).toBe("historical");
    expect(phaseOf(fix("FAILED"))).toBe("not_verified");
  });

  it("VERIFIED is a verified correction ONLY with the exact-commit statement", () => {
    expect(phaseOf(fix("VERIFIED", { verification: verification("exact_commit_rescan_clean") }))).toBe("verified");
    expect(phaseOf(fix("VERIFIED", { verification: verification("later_analysis_clean_unbound") }))).toBe("not_verified");
    // A VERIFIED record whose evidence is a negative (or missing) is a contradiction: never optimistic, never the old reasons.
    expect(phaseOf(fix("VERIFIED", { verification: verification("not_verified") }))).toBe("updating");
    expect(phaseOf(fix("VERIFIED", { verification: null }))).toBe("updating");
  });

  it("the statement is derived from what is persisted (outcome + binding)", () => {
    expect(statementFromPersisted({ outcome: "passed", binding: "exact_proposal_commit" })).toBe("exact_commit_rescan_clean");
    expect(statementFromPersisted({ outcome: "passed", binding: "assisted_unbound" })).toBe("later_analysis_clean_unbound");
    expect(statementFromPersisted({ outcome: "passed", binding: null })).toBe("later_analysis_clean_unbound");
    expect(statementFromPersisted({ outcome: "failed", binding: "exact_proposal_commit" })).toBe("not_verified");
    expect(statementFromPersisted({ outcome: "partial", binding: "exact_proposal_commit" })).toBe("not_verified");
  });
});

describe("reporting the commit: nothing is assumed", () => {
  const suggestion: PanelSuggestion = { branch: "main", commitSha: OTHER, detectedAt: null, analysis: analysis(OTHER) };
  const run = (value: string, extra: Partial<Parameters<typeof checkCommitInput>[0]> = {}) =>
    checkCommitInput({ value, fix: fix("APPROVED"), suggestion, knownAnalyses: [analysis(OTHER), analysis("c".repeat(40), "release")], ...extra });

  it("sha format", () => {
    expect(isFullSha(OTHER)).toBe(true);
    expect(isFullSha(OTHER.toUpperCase())).toBe(true);
    for (const bad of ["", "abc123", "g".repeat(40), OTHER + "0", ` ${OTHER.slice(1)}`]) expect(isFullSha(bad)).toBe(false);
    expect(shortSha(OTHER)).toBe("bbbbbbb");
    expect(shortSha(null)).toBe("—");
  });

  it("empty / short / non-hex are refused with a stable reason", () => {
    expect(run("")).toEqual({ ok: false, reason: "empty" });
    expect(run("   ")).toEqual({ ok: false, reason: "empty" });
    expect(run("abc123")).toEqual({ ok: false, reason: "not_full_sha" });
  });

  it("the base commit cannot be the correction (case-insensitive)", () => {
    expect(run(BASE)).toEqual({ ok: false, reason: "same_as_base" });
    expect(run(BASE.toUpperCase())).toEqual({ ok: false, reason: "same_as_base" });
  });

  it("a valid sha reports the analysis and branch SequrAI already has for exactly that commit, or none", () => {
    const known = run("c".repeat(40));
    expect(known).toMatchObject({ ok: true, commitSha: "c".repeat(40), branch: "release", isSuggestion: false });
    const sug = run(OTHER.toUpperCase());
    expect(sug).toMatchObject({ ok: true, commitSha: OTHER, isSuggestion: true, branch: "main" });
    const unknown = run("d".repeat(40));
    expect(unknown).toMatchObject({ ok: true, analysis: null, branch: null, isSuggestion: false });
  });
});

describe("errors are translated to stable keys", () => {
  it.each([
    [{ status: 404, code: "Not found" }, "not_found"],
    [{ status: 401, code: null }, "forbidden"],
    [{ status: 409, code: "open_fix_exists" }, "open_fix_exists"],
    [{ status: 409, code: "proposal_commit_is_base_commit" }, "commit_is_base"],
    [{ status: 409, code: "proposal_commit_locked" }, "commit_locked"],
    [{ status: 409, code: "proposal_commit_conflict" }, "commit_conflict"],
    [{ status: 409, code: "invalid_transition:READY->VERIFYING" }, "invalid_state"],
    [{ status: 409, code: null }, "invalid_state"],
    [{ status: 503, code: "proposal_commit_unsupported" }, "unsupported"],
    [{ status: 503, code: "network" }, "unavailable"],
    [{ status: 400, code: "Invalid request body" }, "invalid_commit"],
    [{ status: 418, code: null }, "unknown"],
  ])("%j -> %s", (input, key) => expect(errorKeyFor(input)).toBe(key));
});
