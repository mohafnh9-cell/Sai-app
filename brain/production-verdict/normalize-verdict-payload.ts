function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeGeneratedAt(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    let trimmed = value.trim().replace(" ", "T");
    trimmed = trimmed.replace(/([+-]\d{2})$/, "$1:00");
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

/** Coerce legacy/partial persisted verdict JSON before schema validation. */
export function normalizeProductionVerdictPayload(data: unknown): unknown {
  const source = asRecord(data);
  if (!source) return data;

  const normalized: Record<string, unknown> = { ...source };

  if (!normalized.version) normalized.version = "1.0.0";
  if (normalized.projectedScoreIsEstimate === undefined) {
    normalized.projectedScoreIsEstimate = false;
  }
  if (normalized.branch === undefined) normalized.branch = null;

  if (!Array.isArray(normalized.topPriorities)) normalized.topPriorities = [];
  if (!Array.isArray(normalized.evaluatedAreas)) normalized.evaluatedAreas = [];
  if (!Array.isArray(normalized.partiallyEvaluatedAreas)) normalized.partiallyEvaluatedAreas = [];
  if (!Array.isArray(normalized.unevaluatedAreas)) normalized.unevaluatedAreas = [];

  if (!normalized.executiveSummary) {
    normalized.executiveSummary =
      asString(normalized.headline) ||
      asString(normalized.summary) ||
      "Production review completed.";
  }

  if (!normalized.recommendedAction) {
    normalized.recommendedAction =
      asString(normalized.recommended_action) || "Review the Production Verdict details.";
  }

  if (!normalized.methodologyNote) {
    normalized.methodologyNote =
      asString(normalized.methodology) || asString(normalized.methodology_note) || "";
  }

  normalized.generatedAt = normalizeGeneratedAt(normalized.generatedAt);

  if (normalized.branch === undefined) normalized.branch = null;
  if (normalized.commitSha === undefined && normalized.commit_sha !== undefined) {
    normalized.commitSha = normalized.commit_sha;
  }
  if (normalized.projectedScoreIsEstimate === undefined) {
    normalized.projectedScoreIsEstimate = false;
  }

  normalized.blockersCount = asNumber(normalized.blockersCount);
  normalized.criticalBlockersCount = asNumber(normalized.criticalBlockersCount);
  normalized.highBlockersCount = asNumber(normalized.highBlockersCount);
  normalized.estimatedFixMinutes = asNumber(normalized.estimatedFixMinutes);
  normalized.introducedBlockers = asNumber(normalized.introducedBlockers);
  normalized.resolvedBlockers = asNumber(normalized.resolvedBlockers);
  normalized.filesAnalyzed = asNumber(normalized.filesAnalyzed);
  normalized.findingsCount = asNumber(normalized.findingsCount);

  if (normalized.confidence !== "high" && normalized.confidence !== "medium" && normalized.confidence !== "low") {
    normalized.confidence = "medium";
  }

  normalized.topPriorities = (normalized.topPriorities as unknown[]).map((item) => {
    const priority = asRecord(item);
    if (!priority) return item;
    return {
      ...priority,
      affectedFiles: asStringArray(priority.affectedFiles ?? priority.affected_files),
      findingIds: asStringArray(priority.findingIds ?? priority.finding_ids),
      estimatedMinutes: asNumber(priority.estimatedMinutes, 30),
      estimatedTimeLabel: asString(priority.estimatedTimeLabel, "30 min"),
      projectedScoreImpact: asNumber(priority.projectedScoreImpact, 0),
      recommendedAction: asString(priority.recommendedAction, "Review and fix"),
      confidence:
        priority.confidence === "high" || priority.confidence === "medium" || priority.confidence === "low"
          ? priority.confidence
          : "medium",
    };
  });

  return normalized;
}
