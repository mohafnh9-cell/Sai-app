import { describe, expect, it } from "vitest";
import { SCAN_JOB_ORG_CONCURRENCY_LIMIT, SCAN_JOB_TIMEOUT_MS } from "../types";

describe("Inngest operational limits", () => {
  it("limits concurrent scan jobs to three per organization", () => {
    expect(SCAN_JOB_ORG_CONCURRENCY_LIMIT).toBe(3);
  });

  it("uses a fifteen minute finish timeout", () => {
    expect(SCAN_JOB_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });
});
