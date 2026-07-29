export type NormalizedFinding = {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  ruleId?: string;
  filePath?: string;
  recommendation?: string;
  confidence: "high" | "medium" | "low";
  evidence?: string;
};

const HIGH_CONFIDENCE_RULES = new Set([
  "hardcoded-secret",
  "exposed-api-key",
  "exposed-credential",
  "sql-injection",
  "missing-auth",
  "missing-rls",
  "admin-endpoint-unprotected",
]);

export function normalizeFinding(input: {
  id?: string;
  title: string;
  severity?: string | null;
  category?: string | null;
  rule_id?: string | null;
  rule?: string | null;
  file_path?: string | null;
  recommendation?: string | null;
  confidence?: string | number | null;
  evidence?: string | null;
}): NormalizedFinding {
  const severityRaw = (input.severity ?? "medium").toLowerCase();
  const severity = (
    ["critical", "high", "medium", "low", "info"].includes(severityRaw)
      ? severityRaw
      : "medium"
  ) as NormalizedFinding["severity"];

  const ruleId = input.rule_id ?? input.rule ?? undefined;
  const category = (input.category ?? "general").toLowerCase();

  let confidence: NormalizedFinding["confidence"] = "medium";
  if (ruleId && HIGH_CONFIDENCE_RULES.has(ruleId.toLowerCase())) {
    confidence = "high";
  } else if (severity === "critical") {
    confidence = "high";
  } else if (severity === "info") {
    confidence = "low";
  }

  if (typeof input.confidence === "number" && input.confidence >= 0.8) {
    confidence = "high";
  }

  return {
    id: input.id ?? `${ruleId ?? "finding"}-${input.file_path ?? "unknown"}`,
    title: input.title,
    severity,
    category,
    ruleId,
    filePath: input.file_path ?? undefined,
    recommendation: input.recommendation ?? undefined,
    confidence,
    evidence: input.evidence ?? undefined,
  };
}

export function isCriticalSignal(finding: NormalizedFinding): boolean {
  const haystack = `${finding.title} ${finding.category} ${finding.ruleId ?? ""}`.toLowerCase();
  return (
    finding.severity === "critical" ||
    (finding.severity === "high" &&
      finding.confidence === "high" &&
      (haystack.includes("secret") ||
        haystack.includes("credential") ||
        haystack.includes("admin") ||
        haystack.includes("rce") ||
        haystack.includes("remote code")))
  );
}
