import { describe, expect, it } from "vitest";
import {
  validateIdentifierMatrix,
  validatePlatformMetadataShape,
  validateVerdictLinkage,
} from "../validate-platform-metadata.mjs";

describe("validatePlatformMetadataShape", () => {
  it("accepts canonical platform metadata", () => {
    const metadata = {
      platform: {
        version: "1.0.0",
        pipelineStatus: "completed",
        ids: {
          scanId: "scan-1",
          scanJobId: "job-1",
          correlationId: "scan-1",
          executionId: "job-1",
          directorRequestId: "scan-1",
          decisionId: "dec-1",
          verdictId: "ver-1",
        },
        completedAt: new Date().toISOString(),
      },
      correlationId: "scan-1",
    };
    expect(validatePlatformMetadataShape(metadata).valid).toBe(true);
  });

  it("rejects identifier drift", () => {
    const metadata = {
      platform: {
        version: "1.0.0",
        pipelineStatus: "completed",
        ids: {
          scanId: "scan-1",
          scanJobId: "job-1",
          correlationId: "wrong",
          executionId: "job-1",
          directorRequestId: "scan-1",
          decisionId: null,
          verdictId: null,
        },
        completedAt: new Date().toISOString(),
      },
    };
    const result = validatePlatformMetadataShape(metadata);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "correlation_mismatch")).toBe(true);
  });
});

describe("validateVerdictLinkage", () => {
  it("rejects securityDecisionId on failed pipeline", () => {
    const result = validateVerdictLinkage({
      platformMetadata: {
        platform: { pipelineStatus: "failed", ids: { decisionId: null } },
      },
      verdictJson: { securityDecisionId: "dec-1", correlationId: "scan-1" },
    });
    expect(result.valid).toBe(false);
  });
});

describe("validateIdentifierMatrix", () => {
  it("enforces correlation and execution mapping", () => {
    const ok = validateIdentifierMatrix({
      scanId: "s",
      scanJobId: "j",
      correlationId: "s",
      executionId: "j",
      directorRequestId: "s",
    });
    expect(ok.ok).toBe(true);
  });
});
