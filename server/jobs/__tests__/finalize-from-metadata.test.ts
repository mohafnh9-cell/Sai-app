import { describe, expect, it } from "vitest";
import { parseScanRunInngestEvent } from "../inngest-payload";
import { withFinalizeFromJobMetadata } from "../finalize-from-metadata";
import type { ScanRunPayload } from "../types";

const base: ScanRunPayload = {
  scanJobId: "11111111-1111-4111-8111-111111111111",
  scanId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  projectId: "44444444-4444-4444-8444-444444444444",
  userId: "u1",
  jobType: "webhook_pr_scan",
};
const prFinalize = {
  kind: "webhook_pr" as const,
  pullRequestNumber: 2,
  pullRequestTitle: "t",
  baseBranch: "main",
  headBranch: "feat",
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  scoreBefore: 100,
};

describe("PASS 5.7H: PR finalization survives the Inngest payload", () => {
  it("REGRESSION: the Inngest event schema strips `finalize` (the old silent skip)", () => {
    const parsed = parseScanRunInngestEvent({ ...base, finalize: prFinalize });
    expect((parsed as { finalize?: unknown }).finalize).toBeUndefined();
  });

  it("restores finalize from the persisted job metadata", () => {
    const fromEvent = parseScanRunInngestEvent({ ...base, finalize: prFinalize }) as ScanRunPayload;
    const restored = withFinalizeFromJobMetadata(fromEvent, { finalize: prFinalize });
    expect(restored.finalize).toEqual(prFinalize);
  });

  it("never overrides a finalize that is already on the payload", () => {
    const other = { kind: "automatic_review" as const };
    expect(withFinalizeFromJobMetadata({ ...base, finalize: other }, { finalize: prFinalize }).finalize).toEqual(other);
  });

  it.each([[null], [undefined], [{}], [{ finalize: null }], [{ finalize: "x" }], [{ finalize: { kind: "rm -rf" } }], [{ finalize: {} }]])(
    "ignores missing or malformed metadata (%j)",
    (meta) => {
      expect(withFinalizeFromJobMetadata(base, meta as never).finalize).toBeUndefined();
    }
  );
});
