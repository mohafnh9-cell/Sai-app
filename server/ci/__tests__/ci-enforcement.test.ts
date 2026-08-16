import { describe, expect, it } from "vitest";
import { normalizeCommitSha, isValidCommitSha, InvalidCommitShaError } from "../validate-sha";
import { buildCiIdempotencyKey } from "../idempotency-key";
import { verdictStatusToCheckConclusion } from "@/server/github-automation/github-check-run";

describe("validate-sha", () => {
  it("accepts full and abbreviated SHAs", () => {
    const full = "a".repeat(40);
    expect(normalizeCommitSha(full)).toBe(full);
    expect(normalizeCommitSha("AbCdEf1")).toBe("abcdef1");
  });

  it("rejects invalid SHAs", () => {
    expect(() => normalizeCommitSha("")).toThrow(InvalidCommitShaError);
    expect(() => normalizeCommitSha("xyz")).toThrow(InvalidCommitShaError);
    expect(isValidCommitSha("not-hex")).toBe(false);
  });
});

describe("buildCiIdempotencyKey", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const sha = "abc123def4567890abcdef1234567890abcdef12";

  it("is deterministic for push", () => {
    const key = buildCiIdempotencyKey({ projectId, commitSha: sha });
    expect(key).toBe(`sequrai-ci:${projectId}:${sha}:push`);
  });

  it("includes PR number when provided", () => {
    const key = buildCiIdempotencyKey({ projectId, commitSha: sha, prNumber: 42 });
    expect(key).toBe(`sequrai-ci:${projectId}:${sha}:pr-42`);
  });
});

describe("verdictStatusToCheckConclusion (CI contract)", () => {
  it("maps ready_to_ship to success", () => {
    expect(verdictStatusToCheckConclusion("ready_to_ship")).toBe("success");
  });

  it("maps not_ready and almost_ready to failure", () => {
    expect(verdictStatusToCheckConclusion("not_ready")).toBe("failure");
    expect(verdictStatusToCheckConclusion("almost_ready")).toBe("failure");
  });

  it("maps insufficient_data to action_required", () => {
    expect(verdictStatusToCheckConclusion("insufficient_data")).toBe("action_required");
  });

  it("maps pending to neutral", () => {
    expect(verdictStatusToCheckConclusion(null, { checkStatus: "pending" })).toBe("neutral");
  });

  it("does not fabricate success for missing scan", () => {
    expect(verdictStatusToCheckConclusion(null, { scanMissing: true })).toBe("neutral");
  });
});
