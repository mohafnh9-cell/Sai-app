import type { NormalizedFinding } from "./normalize-finding";
import type { AreaKey, ProductionAreaAssessment } from "./schema";

const AREA_DEFINITIONS: Record<
  AreaKey,
  { label: string; defaultStatus: ProductionAreaAssessment["status"]; methodology: string; limitations?: string }
> = {
  security: {
    label: "Security",
    defaultStatus: "evaluated",
    methodology: "Static analysis of source files against security rules plus correlated security tests.",
  },
  authentication: {
    label: "Authentication",
    defaultStatus: "evaluated",
    methodology: "Auth routes, sessions, tokens, OAuth, password reset, and MFA patterns in code review.",
    limitations: "Live credential flows require authorized staging for full dynamic confirmation.",
  },
  authorization: {
    label: "Authorization",
    defaultStatus: "evaluated",
    methodology: "RBAC, ownership checks, tenant isolation, IDOR/BOLA patterns, and admin routes.",
    limitations: "Cross-user attacks run in mock or authorized staging modes only.",
  },
  data_protection: {
    label: "Data Protection",
    defaultStatus: "evaluated",
    methodology: "Secrets, credentials, client exposure, and sensitive data handling via static rules.",
    limitations: "Encryption at rest and transit inferred from configuration patterns only.",
  },
  dependencies: {
    label: "Dependencies",
    defaultStatus: "evaluated",
    methodology: "Manifest, lockfile, and security-sensitive dependency catalog analysis.",
    limitations: "Live CVE advisory feeds are not queried in this pass.",
  },
  architecture: {
    label: "Architecture",
    defaultStatus: "evaluated",
    methodology: "Structural inference from routes, modules, and deployment configuration.",
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
    defaultStatus: "evaluated",
    methodology: "CI/CD workflows, deployment configuration, and supply-chain static checks.",
    limitations: "Actual deployment environment not inspected live.",
  },
  observability: {
    label: "Observability",
    defaultStatus: "not_evaluated",
    methodology: "Detects metrics, health endpoints, and operational event instrumentation.",
    limitations: "Does not verify external monitoring integrations.",
  },
  database: {
    label: "Database",
    defaultStatus: "evaluated",
    methodology: "SQL, RLS assessment, ORM misuse, and database configuration findings.",
    limitations: "Live database policies are inferred from migrations unless staging attacks run.",
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
  authorization: ["authorization", "authentication", "security"],
  injection: ["security", "database"],
  xss: ["security"],
  web: ["security", "deployment"],
  api: ["security", "architecture"],
  cicd: ["deployment", "security"],
  validation: ["security", "architecture"],
  configuration: ["deployment", "security"],
  database: ["database", "security"],
  dependencies: ["dependencies"],
  architecture: ["architecture"],
  testing: ["testing"],
  performance: ["performance"],
  observability: ["observability"],
  reliability: ["reliability"],
  availability: ["security", "authentication"],
};

function areaEvidenceCount(area: AreaKey, findings: NormalizedFinding[]): number {
  return findings.filter((f) => {
    if (f.ruleId === "readiness.area-baseline" || f.ruleId === "security.area-baseline") {
      return false;
    }
    const areas = CATEGORY_TO_AREAS[f.category] ?? ["security"];
    return areas.includes(area);
  }).length;
}

function baselineStatusFromFindings(
  area: AreaKey,
  findings: NormalizedFinding[]
): ProductionAreaAssessment["status"] | null {
  const readiness = findings.find(
    (finding) =>
      finding.ruleId === "readiness.area-baseline" && finding.category === area
  );
  if (readiness) {
    if (readiness.evidence?.includes("level=evaluated")) return "evaluated";
    return "evaluated";
  }

  const securityBaseline = findings.find((finding) => {
    if (finding.ruleId !== "security.area-baseline") return false;
    return finding.evidence?.includes(`area=${area}`);
  });
  if (securityBaseline) return "evaluated";

  return null;
}

function resolveAreaStatus(
  area: AreaKey,
  evidenceCount: number,
  filesAnalyzed: number,
  findings: NormalizedFinding[]
): ProductionAreaAssessment["status"] {
  const baseline = baselineStatusFromFindings(area, findings);
  if (baseline === "evaluated") return "evaluated";

  const def = AREA_DEFINITIONS[area];

  if (def.defaultStatus === "not_evaluated" && evidenceCount === 0 && !baseline) {
    if (filesAnalyzed >= 50) return "evaluated";
    return "not_evaluated";
  }

  if (def.defaultStatus === "evaluated" && filesAnalyzed > 0) {
    return "evaluated";
  }

  if (evidenceCount > 0 || (area === "security" && filesAnalyzed > 0)) {
    return def.defaultStatus === "not_evaluated" ? "evaluated" : def.defaultStatus;
  }

  if (def.defaultStatus === "evaluated") return "evaluated";
  if (filesAnalyzed > 0 && def.defaultStatus !== "not_evaluated") return "evaluated";
  return "not_evaluated";
}

function penalizingEvidenceCount(area: AreaKey, findings: NormalizedFinding[]): number {
  return findings.filter((f) => {
    const areas = CATEGORY_TO_AREAS[f.category] ?? ["security"];
    if (!areas.includes(area)) return false;
    if (f.ruleId === "readiness.area-baseline" || f.ruleId === "security.area-baseline") return false;
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
    if (status === "evaluated") {
      confidence = evidenceCount > 0 ? "high" : "medium";
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
  if (input.filesAnalyzed >= 3) return true;
  if (input.coverageRatio != null && input.coverageRatio < 0.15) return false;
  return true;
}
