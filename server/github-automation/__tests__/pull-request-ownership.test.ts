import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let defaultBranch = "main";
vi.mock("@/server/repository-sync/persistence", () => ({
  isDefaultBranchHead: async (_a: unknown, _p: string, branch: string) => branch === defaultBranch,
}));

import { findOwningOpenPullRequest } from "../pull-request-ownership";
import { commitStatusStateFor, githubDecisionPresentation } from "../github-check-run";

const base = { projectId: "p", githubRepo: "o/r", token: "t" } as const;
const json = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("findOwningOpenPullRequest", () => {
  it("returns the PR number for a feature branch with an open PR", async () => {
    expect(await findOwningOpenPullRequest({} as never, { ...base, branch: "feat", fetchImpl: json([{ number: 7 }]) })).toBe(7);
  });
  it("returns null for the default branch without calling GitHub", async () => {
    const f = vi.fn();
    expect(await findOwningOpenPullRequest({} as never, { ...base, branch: "main", fetchImpl: f as never })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("returns null when there is no open PR, on API error, and on network failure (fail open)", async () => {
    expect(await findOwningOpenPullRequest({} as never, { ...base, branch: "feat", fetchImpl: json([]) })).toBeNull();
    expect(await findOwningOpenPullRequest({} as never, { ...base, branch: "feat", fetchImpl: json({}, false) })).toBeNull();
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect(await findOwningOpenPullRequest({} as never, { ...base, branch: "feat", fetchImpl: boom })).toBeNull();
  });
});

describe("commitStatusStateFor", () => {
  const v = (status: string, confidence: string, un = 0) =>
    ({ status, confidence, unevaluatedAreas: new Array(un).fill({}), partiallyEvaluatedAreas: [] }) as never;
  const state = (status: string, confidence: string, un: number, check: "passed" | "failed" | "warning" | "pending") => {
    const verdict = v(status, confidence, un);
    return commitStatusStateFor(githubDecisionPresentation(verdict, { checkStatus: check }), status as never, check);
  };
  it("success only for high-confidence full-coverage ready verdicts", () => {
    expect(state("ready_to_ship", "high", 0, "passed")).toBe("success");
  });
  it("evidence-limited ready is pending, never success", () => {
    expect(state("ready_to_ship", "medium", 4, "passed")).toBe("pending");
    expect(state("ready_to_ship", "low", 0, "passed")).toBe("pending");
  });
  it("insufficient data is pending, analysis_failed is error, not_ready is failure", () => {
    expect(state("insufficient_data", "low", 0, "pending")).toBe("pending");
    expect(state("analysis_failed", "low", 0, "failed")).toBe("error");
    expect(state("not_ready", "high", 0, "failed")).toBe("failure");
    expect(state("needs_improvement", "medium", 0, "warning")).toBe("failure");
  });
  it("a failed security check is never success even for a ready verdict", () => {
    expect(state("ready_to_ship", "high", 0, "failed")).toBe("failure");
  });
});
