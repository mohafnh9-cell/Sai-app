import { describe, expect, it } from "vitest";
import {
  isActiveReviewScanStatus,
  mapScanStatusToReviewStatus,
  shouldRunAutomaticReview,
  validateCommitForReview,
} from "@/brain/automatic-review";
import { loadNamespace } from "@/lib/i18n/load-messages";
import { formatRelativeLocalized } from "@/lib/i18n/format";

const VALID_COMMIT = "8a5f92bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REPO_ID = 12345;

describe("Block 7.0.2 commit validation", () => {
  it("accepts valid commit metadata", () => {
    expect(
      validateCommitForReview({
        commitSha: VALID_COMMIT,
        branch: "main",
        githubRepositoryId: REPO_ID,
        expectedRepositoryId: REPO_ID,
        pushedAt: "2026-07-18T00:30:00Z",
      })
    ).toEqual({ valid: true, errorCode: null });
  });

  it("rejects missing or invalid commit sha", () => {
    expect(
      validateCommitForReview({
        commitSha: "short",
        branch: "main",
        githubRepositoryId: REPO_ID,
        expectedRepositoryId: REPO_ID,
        pushedAt: "2026-07-18T00:30:00Z",
      }).errorCode
    ).toBe("missing_commit");
  });

  it("rejects repository id mismatch", () => {
    expect(
      validateCommitForReview({
        commitSha: VALID_COMMIT,
        branch: "main",
        githubRepositoryId: REPO_ID,
        expectedRepositoryId: 999,
        pushedAt: "2026-07-18T00:30:00Z",
      }).errorCode
    ).toBe("invalid_repository");
  });
});

describe("Block 7.0.2 automatic review rules", () => {
  const baseInput = {
    repositoryConnected: true,
    commitValidation: { valid: true, errorCode: null },
    detection: {
      branch: "main",
      commitSha: VALID_COMMIT,
      commitMessage: "Fix",
      pushedAt: "2026-07-18T00:30:00Z",
    },
    hasActiveReview: false,
    hasCompletedReviewForCommit: false,
  };

  it("runs when repository is connected and commit is new", () => {
    expect(shouldRunAutomaticReview(baseInput)).toEqual({ shouldRun: true });
  });

  it("skips duplicate reviews for the same commit", () => {
    expect(
      shouldRunAutomaticReview({
        ...baseInput,
        hasCompletedReviewForCommit: true,
      })
    ).toEqual({ shouldRun: false, reason: "duplicate_review" });
  });

  it("skips when a review is already in progress", () => {
    expect(
      shouldRunAutomaticReview({
        ...baseInput,
        hasActiveReview: true,
      })
    ).toEqual({ shouldRun: false, reason: "review_in_progress" });
  });

  it("skips when repository is disconnected", () => {
    expect(
      shouldRunAutomaticReview({
        ...baseInput,
        repositoryConnected: false,
      })
    ).toEqual({ shouldRun: false, reason: "repository_disconnected" });
  });
});

describe("Block 7.0.2 review status", () => {
  it("maps scan statuses to review statuses", () => {
    expect(mapScanStatusToReviewStatus("queued")).toBe("pending");
    expect(mapScanStatusToReviewStatus("scanning")).toBe("processing");
    expect(mapScanStatusToReviewStatus("completed")).toBe("completed");
    expect(mapScanStatusToReviewStatus("failed")).toBe("failed");
  });

  it("detects active review scans", () => {
    expect(isActiveReviewScanStatus("queued")).toBe(true);
    expect(isActiveReviewScanStatus("calculating_score")).toBe(true);
    expect(isActiveReviewScanStatus("completed")).toBe(false);
  });
});

describe("Block 7.0.2 automatic review i18n", () => {
  it("loads automaticReview namespace in English and Spanish", () => {
    const en = loadNamespace("en", "automaticReview");
    const es = loadNamespace("es", "automaticReview");

    expect(en.title).toBe("Production Review");
    expect(es.title).toBe("Revisión de producción");
    expect(en.enabled).toBe("Enabled.");
    expect(es.enabled).toBe("Activado.");
    expect((en.status as Record<string, string>).completed).toBe("Completed");
    expect((es.status as Record<string, string>).completed).toBe("Completada");
  });

  it("formats latest automatic review time in Spanish", () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const es = loadNamespace("es", "automaticReview");
    const relative = es.relative as Record<string, string>;
    const result = formatRelativeLocalized("es", twoMinutesAgo, {
      never: relative.never,
      justNow: relative.justNow,
      minutesAgo: relative.minutesAgo,
      hoursAgo: relative.hoursAgo,
      daysAgo: relative.daysAgo,
    });
    expect(result).toContain("2");
    expect(result).toContain("min");
  });
});
