import { describe, expect, it } from "vitest";
import {
  assertSafeInngestScanRunPayload,
  buildInngestWebhookProcessPayload,
  extractWebhookMetadata,
  loadWebhookPayloadFromJobMetadata,
} from "../inngest-payload";
import type { ScanRunPayload } from "../types";

describe("Inngest payload security", () => {
  const basePayload: ScanRunPayload = {
    scanJobId: "job-1",
    scanId: "scan-1",
    organizationId: "org-1",
    projectId: "project-1",
    userId: "user-1",
  };

  it("rejects forbidden keys in scan/run payloads", () => {
    expect(() =>
      assertSafeInngestScanRunPayload({
        ...basePayload,
        providerToken: "gh-secret",
      } as ScanRunPayload & { providerToken: string })
    ).toThrow("must not include");
  });

  it("webhook process events contain only scanJobId", () => {
    expect(buildInngestWebhookProcessPayload("job-123")).toEqual({ scanJobId: "job-123" });
  });

  it("extracts minimal webhook metadata without file contents", () => {
    const metadata = extractWebhookMetadata({
      repository: { id: 42, full_name: "acme/app" },
      ref: "refs/heads/main",
      after: "abc123",
      head_commit: { id: "abc123", message: "fix: auth" },
    });

    expect(metadata).toMatchObject({
      eventRepositoryId: 42,
      eventRepositoryName: "acme/app",
      ref: "refs/heads/main",
      headCommitSha: "abc123",
    });
    expect(metadata).not.toHaveProperty("webhookPayload");
  });

  it("loads webhook payload from job metadata in workers", () => {
    const payload = loadWebhookPayloadFromJobMetadata({
      webhookPayload: { repository: { id: 42 } },
      eventType: "push",
    });
    expect(payload).toEqual({ repository: { id: 42 } });
  });
});

describe("org concurrency configuration", () => {
  it("limits concurrent scan jobs to three per organization", async () => {
    const { SCAN_JOB_ORG_CONCURRENCY_LIMIT } = await import("../types");
    expect(SCAN_JOB_ORG_CONCURRENCY_LIMIT).toBe(3);
  });
});
