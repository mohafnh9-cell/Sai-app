/**
 * Runtime validation for persisted scan_jobs.metadata (platform convergence).
 */

export function validatePlatformMetadataShape(metadata) {
  const issues = [];
  if (!metadata || typeof metadata !== "object") {
    return { valid: false, issues: [{ code: "missing_metadata", message: "metadata is empty" }] };
  }

  const platform = metadata.platform ?? metadata.platformConvergence;
  if (!platform || typeof platform !== "object") {
    issues.push({ code: "missing_platform", message: "metadata.platform or platformConvergence required" });
  } else {
    if (platform.version !== "1.0.0") {
      issues.push({ code: "invalid_platform_version", message: `Expected platform version 1.0.0, got ${platform.version}` });
    }
    const ids = platform.ids;
    if (!ids || typeof ids !== "object") {
      issues.push({ code: "missing_ids", message: "platform.ids required" });
    } else {
      if (ids.correlationId !== ids.scanId) {
        issues.push({ code: "correlation_mismatch", message: "correlationId must equal scanId" });
      }
      if (ids.executionId !== ids.scanJobId) {
        issues.push({ code: "execution_mismatch", message: "executionId must equal scanJobId" });
      }
      if (ids.directorRequestId !== ids.scanId) {
        issues.push({ code: "director_request_mismatch", message: "directorRequestId must equal scanId" });
      }
    }
    if (!platform.pipelineStatus && !platform.convergenceStatus) {
      issues.push({ code: "missing_pipeline_status", message: "pipelineStatus required" });
    }
  }

  if (metadata.correlationId && platform?.ids?.correlationId && metadata.correlationId !== platform.ids.correlationId) {
    issues.push({ code: "flat_correlation_drift", message: "Top-level correlationId drift from platform.ids" });
  }

  return { valid: issues.length === 0, issues };
}

export function validateVerdictLinkage({ platformMetadata, verdictJson }) {
  const issues = [];
  if (!verdictJson || typeof verdictJson !== "object") {
    issues.push({ code: "missing_verdict", message: "verdict JSON missing" });
    return { valid: false, issues };
  }
  const platform = platformMetadata?.platform ?? platformMetadata?.platformConvergence;
  const decisionId = platform?.ids?.decisionId ?? platformMetadata?.decisionId;
  const pipelineStatus = platform?.pipelineStatus;

  if (
    (pipelineStatus === "completed" || pipelineStatus === "partial") &&
    decisionId &&
    verdictJson.securityDecisionId &&
    verdictJson.securityDecisionId !== decisionId
  ) {
    issues.push({
      code: "decision_id_mismatch",
      message: "verdict.securityDecisionId does not match platform metadata decisionId",
    });
  }
  if ((pipelineStatus === "failed" || pipelineStatus === "skipped") && verdictJson.securityDecisionId) {
    issues.push({
      code: "false_decision_on_failure",
      message: "securityDecisionId must not be set when red-team phase failed/skipped",
    });
  }
  if (verdictJson.correlationId && platform?.ids?.scanId && verdictJson.correlationId !== platform.ids.scanId) {
    issues.push({ code: "verdict_correlation_mismatch", message: "verdict correlationId must equal scanId" });
  }
  return { valid: issues.length === 0, issues };
}

export function validateIdentifierMatrix(ids) {
  const expected = {
    correlationId: ids.scanId,
    executionId: ids.scanJobId,
    directorRequestId: ids.scanId,
  };
  const mismatches = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (ids[key] !== expectedValue) mismatches.push({ key, expected: expectedValue, actual: ids[key] });
  }
  return { ok: mismatches.length === 0, mismatches };
}
