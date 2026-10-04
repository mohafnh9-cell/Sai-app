import { describe, expect, it } from "vitest";
import { verdictStatusToCheckConclusion } from "@/server/github-automation/github-check-run";

describe("verdictStatusToCheckConclusion", () => {
  it("maps GO to success", () => {
    expect(verdictStatusToCheckConclusion("ready_to_ship")).toBe("success");
  });

  it("maps NO-GO statuses to failure", () => {
    expect(verdictStatusToCheckConclusion("not_ready")).toBe("failure");
    expect(verdictStatusToCheckConclusion("almost_ready")).toBe("failure");
  });

  it("maps insufficient_data to action_required", () => {
    expect(verdictStatusToCheckConclusion("insufficient_data")).toBe("action_required");
  });

  it("maps analysis_failed and missing scan to failure/neutral", () => {
    expect(verdictStatusToCheckConclusion("analysis_failed")).toBe("failure");
    expect(
      verdictStatusToCheckConclusion(null, { scanMissing: true })
    ).toBe("neutral");
    expect(
      verdictStatusToCheckConclusion("ready_to_ship", { checkStatus: "pending" })
    ).toBe("neutral");
  });
});

import { afterEach, beforeEach, vi } from "vitest";
import {
  githubDecisionPresentation,
  postGitHubCheckRun,
  postUnavailableGitHubCheckRun,
} from "@/server/github-automation/github-check-run";
import { containsApprovalLanguage } from "@/brain/production-verdict/narrative-guard";
import { statusFromSecurityCheck } from "@/server/github-automation/github-status";
import { buildVerdictFixture } from "@/server/mcp/__tests__/verdict-fixture";

vi.mock("server-only", () => ({}));

const AREA = { key: "testing", label: "t", status: "not_evaluated", score: null, confidence: "low", evidenceCount: 0, methodology: "m" } as never;
const ready = (over: Record<string, unknown> = {}) =>
  buildVerdictFixture({ status: "ready_to_ship", blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, topPriorities: [], ...over } as never);

describe("PASS 5.7H: GitHub check presentation follows the decision policy", () => {
  it("ready + high confidence + all areas evaluated is the only GO / success", () => {
    const p = githubDecisionPresentation(ready({ confidence: "high" }));
    expect(p).toMatchObject({ conclusion: "success", title: "GO" });
  });

  it.each([
    ["low confidence", { confidence: "low" }],
    ["unevaluated areas", { confidence: "high", unevaluatedAreas: [AREA, AREA, AREA, AREA] }],
    ["medium confidence", { confidence: "medium" }],
  ])("ready + %s is never GO / success / 'Ready to Ship'", (_n, over) => {
    const p = githubDecisionPresentation(ready(over));
    expect(p.conclusion).toBe("neutral");
    expect(p.title).not.toBe("GO");
    expect(p.label).not.toMatch(/ready to ship/i);
    expect(containsApprovalLanguage(`${p.title} ${p.label}`)).toBe(false);
  });

  it("non-ready statuses keep their non-success conclusions", () => {
    expect(githubDecisionPresentation(ready({ status: "not_ready", confidence: "high" })).conclusion).toBe("failure");
    expect(githubDecisionPresentation(ready({ status: "insufficient_data" })).conclusion).toBe("action_required");
    expect(githubDecisionPresentation(ready({ status: "analysis_failed" })).title).toBe("ANALYSIS FAILED");
  });

  it("a warning check status is a terminal failure, never a stuck 'pending'", () => {
    expect(statusFromSecurityCheck("warning")).toBe("failure");
    expect(statusFromSecurityCheck("failed")).toBe("failure");
    expect(statusFromSecurityCheck("passed")).toBe("success");
  });
});

describe("PASS 5.7H: PR check run is updated to a terminal state", () => {
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  let existing: Array<{ id: number; status: string; external_id: string }> = [];
  let failWrites = false;

  beforeEach(() => {
    calls.length = 0;
    existing = [];
    failWrites = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        const method = init?.method ?? "GET";
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
        if (method === "GET") return new Response(JSON.stringify({ check_runs: existing }), { status: 200 });
        if (failWrites) return new Response("{}", { status: 500 });
        return new Response(JSON.stringify({ id: existing[0]?.id ?? 999 }), { status: 200 });
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const args = {
    githubRepo: "https://github.com/acme/alpha",
    sha: "abcdef1234567890",
    token: "t",
    pullRequestNumber: 7,
    externalId: "sequrai-pr-7-abcdef123456",
  };

  it("updates (PATCH) the open in_progress run instead of creating a second one", async () => {
    existing = [{ id: 42, status: "in_progress", external_id: args.externalId }];
    const r = await postGitHubCheckRun({ ...args, conclusion: "success", verdict: ready({ confidence: "low" }) as never });
    const write = calls.find((c) => c.method !== "GET")!;
    expect(write.method).toBe("PATCH");
    expect(write.url).toMatch(/check-runs\/42$/);
    expect(write.body?.status).toBe("completed");
    expect(r.checkRunId).toBe(42);
  });

  it("a low-confidence ready verdict is written as neutral, even if the caller asked for success", async () => {
    existing = [{ id: 42, status: "in_progress", external_id: args.externalId }];
    await postGitHubCheckRun({ ...args, conclusion: "success", verdict: ready({ confidence: "low" }) as never });
    const write = calls.find((c) => c.method !== "GET")!;
    expect(write.body?.conclusion).toBe("neutral");
    expect((write.body?.output as { title: string }).title).not.toBe("GO");
    expect(containsApprovalLanguage(JSON.stringify(write.body?.output))).toBe(false);
  });

  it("creates a run only when none is open, and never reopens a completed one (retry-safe)", async () => {
    existing = [{ id: 42, status: "completed", external_id: args.externalId }];
    await postGitHubCheckRun({ ...args, conclusion: "failure", verdict: ready({ status: "not_ready", confidence: "high" }) as never });
    const write = calls.find((c) => c.method !== "GET")!;
    expect(write.method).toBe("POST");
  });

  it("ignores open runs that belong to another external id", async () => {
    existing = [{ id: 5, status: "in_progress", external_id: "someone-else" }];
    await postGitHubCheckRun({ ...args, conclusion: "failure", verdict: ready({ status: "not_ready" }) as never });
    expect(calls.find((c) => c.method !== "GET")!.method).toBe("POST");
  });

  it("a GitHub API failure throws (observable, retryable) instead of silently leaving the check open", async () => {
    existing = [{ id: 42, status: "in_progress", external_id: args.externalId }];
    failWrites = true;
    await expect(
      postGitHubCheckRun({ ...args, conclusion: "failure", verdict: ready({ status: "not_ready" }) as never })
    ).rejects.toThrow(/check run update failed \(500\)/);
  });

  it("verdict unavailable closes the open run as neutral, never success, never an approval", async () => {
    existing = [{ id: 42, status: "in_progress", external_id: args.externalId }];
    await postUnavailableGitHubCheckRun({ ...args, reason: "verdict not produced in time" });
    const write = calls.find((c) => c.method !== "GET")!;
    expect(write.method).toBe("PATCH");
    expect(write.body).toMatchObject({ status: "completed", conclusion: "neutral" });
    expect(containsApprovalLanguage(JSON.stringify(write.body?.output))).toBe(false);
    expect(JSON.stringify(write.body?.output)).toMatch(/not an approval/i);
  });
});
