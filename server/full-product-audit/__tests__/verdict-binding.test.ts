import { describe, expect, it } from "vitest";
import { buildVerdictFixture } from "@/server/mcp/__tests__/verdict-fixture";
import { bindVerdictToScan } from "../verdict-binding";

// Phase Z v2 Pass 3 (CRIT-003): a verdict describes one scan. Presenting the
// project's current verdict as the result of an audit of a different scan
// would let stale (or another review's) evidence stand in for this one.
describe("bindVerdictToScan", () => {
  const SCAN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const SCAN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("keeps a verdict that was generated from the audited scan", () => {
    const verdict = buildVerdictFixture({ scanId: SCAN_A, status: "insufficient_data" });
    expect(bindVerdictToScan(verdict, SCAN_A)).toBe(verdict);
  });

  it("rejects a ready_to_ship verdict that belongs to a different scan", () => {
    const verdict = buildVerdictFixture({ scanId: SCAN_B, status: "ready_to_ship", score: 100 });
    expect(bindVerdictToScan(verdict, SCAN_A)).toBeNull();
  });

  it("returns null when there is no persisted verdict", () => {
    expect(bindVerdictToScan(null, SCAN_A)).toBeNull();
  });
});
