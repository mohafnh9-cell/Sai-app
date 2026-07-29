import type { NormalizedFinding } from "./normalize-finding";
import type { AreaKey, ProductionAreaAssessment } from "./schema";

const AREA_DEFINITIONS: Record<
  AreaKey,
  { label: string; defaultStatus: ProductionAreaAssessment["status"]; methodology: string; limitations?: string }
> = {
  security: {
    label: "Security",
    defaultStatus: "evaluated",
    methodology: "Static analysis of source files against security rules.",
  },
  authentication: {
    label: "Authentication",
    defaultStatus: "partial",
    methodology: "Inferred from auth-related findings and configuration patterns.",
    limitations: "Runtime auth flows are not executed.",
  },
  authorization: {
    label: "Authorization",
    defaultStatus: "partial",
    methodology: "Inferred from authorization and access-control findings.",
    limitations: "Resource ownership is not tested at runtime.",
  },
  data_protection: {
    label: "Data Protection",
    defaultStatus: "partial",
    methodology: "Secrets and sensitive data exposure via static rules.",
    limitations: "Encryption at rest and transit not fully verified.",
  },
  dependencies: {
    label: "Dependencies",
    defaultStatus: "not_evaluated",
    methodology: "Manifest and lockfile analysis during repository scan.",
    limitations: "CVE database lookup not included in v1.",
  },
  architecture: {
    label: "Architecture",
    defaultStatus: "partial",
    methodology: "Lightweight structural inference from file patterns.",
    limitations: "No runtime topology or load analysis.",
  },
  testing: {
    label: "Testing",
    defaultStatus: "not_evaluated",
    methodology: "Detects automated test files and runner configuration in the repository.",
    limitations: "Does not execute tests or measure coverage percentages.",
  },
  performance: {
    label: "Performance",
    defaultStatus: "not_evaluated",
    methodology: "Static signals for caching, timing hooks, and framework config.",
    limitations: "No profiling or load testing.",
  },
  deployment: {
    label: "Deployment",
    defaultStatus: "partial",
    methodology: "Configuration and deployment-related static checks.",
    limitations: "Actual deployment environment not inspected.",
  },
  observability: {
    label: "Observability",
    defaultStatus: "not_evaluated",
    methodology: "Detects metrics, health endpoints, and operational event instrumentation.",
    limitations: "Does not verify external monitoring integrations.",
  },
  database: {
    label: "Database",
    defaultStatus: "partial",
    methodology: "SQL, RLS, and database configuration findings.",
    limitations: "Live database policies not executed.",
  },
  reliability: {
    label: "Reliability",
    defaultStatus: "not_evaluated",
    methodology: "Detects background workers, recovery jobs, and idempotency patterns.",
    limitations: "Fault injection and chaos testing are not performed.",
  },
};

const CATEGORY_TO_AREAS: Record<string, AreaKey[]> = {
  secrets: ["security", "data_protection"],
  authentication: ["authentication", "security"],
  authorization: ["authorization", "authentication"],
  injection: ["security", "database"],
  xss: ["security"],
  web: ["security", "deployment"],
  configuration: ["deployment", "security"],
  database: ["database", "security"],
  dependencies: ["dependencies"],
  architecture: ["architecture"],
  testing: ["testing"],
  performance: ["performance"],
  observability: ["observability"],
  reliability: ["reliability"],
};

function areaEvidenceCount(area: AreaKey, findings: NormalizedFinding[]): number {
  return findings.filter((f) => {
    const areas = CATEGORY_TO_AREAS[f.category] ?? ["security"];
    return areas.includes(area);
  }).length;
}

function readinessStatusFromFindings(
  area: AreaKey,
  findings: NormalizedFinding[]
): ProductionAreaAssessment["status"] | null {
  const hit = findings.find(
    (finding) =>
      finding.ruleId === "readiness.area-baseline" && finding.category === area
  );
  if (!hit) return null;
  if (hit.evidence?.includes("level=evaluated")) return "evaluated";
  if (hit.evidence?.includes("level=partial")) return "partial";
  return "partial";
}

function resolveAreaStatus(
  area: AreaKey,
  evidenceCount: number,
  filesAnalyzed: number,
  findings: NormalizedFinding[]
): ProductionAreaAssessment["status"] {
  const readiness = readinessStatusFromFindings(area, findings);
  if (readiness === "evaluated") return "evaluated";
  const def = AREA_DEFINITIONS[area];
  if (def.defaultStatus === "not_evaluated" && evidenceCount === 0 && !readiness) {
    return "not_evaluated";
  }
  if (readiness === "partial") return "partial";
  if (def.defaultStatus === "evaluated" && filesAnalyzed > 0) {
    return "evaluated";
  }
  if (evidenceCount > 0 || (area === "security" && filesAnalyzed > 0)) {
    return def.defaultStatus === "not_evaluated" ? "partial" : def.defaultStatus;
  }
  if (def.defaultStatus === "evaluated") return "evaluated";
  if (def.defaultStatus === "partial" && filesAnalyzed > 0) return "partial";
  return "not_evaluated";
}

function penalizingEvidenceCount(area: AreaKey, findings: NormalizedFinding[]): number {
  return findings.filter((f) => {
    const areas = CATEGORY_TO_AREAS[f.category] ?? ["security"];
    if (!areas.includes(area)) return false;
    if (f.ruleId === "readiness.area-baseline") return false;
    return f.severity !== "info";
  }).length;
}

function areaScore(
  area: AreaKey,
  status: ProductionAreaAssessment["status"],
  securityScore: number | null,
  findings: NormalizedFinding[]
): number | null {
  if (status === "not_evaluated") return null;
  if (securityScore === null) return null;
  if (area === "security") return securityScore;

  const penalty = Math.min(40, penalizingEvidenceCount(area, findings) * 8);
  if (status === "partial") {
    return Math.max(0, Math.min(100, Math.round(securityScore * 0.85 - penalty)));
  }
  return Math.max(0, Math.min(100, securityScore - penalty));
}

export function assessCoverage(input: {
  findings: NormalizedFinding[];
  securityScore: number | null;
  filesAnalyzed: number;
}): {
  evaluatedAreas: ProductionAreaAssessment[];
  partiallyEvaluatedAreas: ProductionAreaAssessment[];
  unevaluatedAreas: ProductionAreaAssessment[];
  coverageRatio: number | null;
} {
  const { findings, securityScore, filesAnalyzed } = input;
  const allAreas = Object.keys(AREA_DEFINITIONS) as AreaKey[];

  const assessments: ProductionAreaAssessment[] = allAreas.map((key) => {
    const def = AREA_DEFINITIONS[key];
    const evidenceCount = areaEvidenceCount(key, findings);
    const status = resolveAreaStatus(key, evidenceCount, filesAnalyzed, findings);
    const score = areaScore(key, status, securityScore, findings);

    let confidence: ProductionAreaAssessment["confidence"] = "low";
    if (status === "evaluated") confidence = "high";
    else if (status === "partial" && (evidenceCount > 0 || readinessStatusFromFindings(key, findings))) {
      confidence = "medium";
    }

    return {
      key,
      label: def.label,
      status,
      score,
      confidence,
      evidenceCount,
      methodology: def.methodology,
      limitations: def.limitations,
    };
  });

  const evaluatedAreas = assessments.filter((a) => a.status === "evaluated");
  const partiallyEvaluatedAreas = assessments.filter((a) => a.status === "partial");
  const unevaluatedAreas = assessments.filter((a) => a.status === "not_evaluated");

  const coverageRatio =
    filesAnalyzed > 0
      ? Math.min(
          1,
          Math.max(
            filesAnalyzed >= 10 ? 0.2 : 0,
            findings.length > 0
              ? 0.4 + Math.min(0.6, filesAnalyzed / 200)
              : filesAnalyzed / 100
          )
        )
      : null;

  return {
    evaluatedAreas,
    partiallyEvaluatedAreas,
    unevaluatedAreas,
    coverageRatio,
  };
}

export function hasSufficientCoverage(input: {
  filesAnalyzed: number;
  coverageRatio: number | null;
  scanStatus: string;
}): boolean {
  if (input.scanStatus === "failed") return false;
  if (input.filesAnalyzed < 3) return false;
  if (input.coverageRatio != null && input.coverageRatio < 0.15) return false;
  return true;
}
