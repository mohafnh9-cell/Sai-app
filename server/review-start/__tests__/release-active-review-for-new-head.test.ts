import { describe, expect, it } from "vitest";
import { COMMIT_SUPERSEDED_CODE } from "@/server/review-start/release-active-review-for-new-head";

describe("releaseActiveReviewForNewHead constants", () => {
  it("uses a stable superseded error code", () => {
    expect(COMMIT_SUPERSEDED_CODE).toBe("COMMIT_SUPERSEDED_BY_REMOTE_HEAD");
  });
});
