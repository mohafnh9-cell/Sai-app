import type { NormalizedFinding } from "./normalize-finding";
import type { ProductionPriority } from "./schema";
import { isHighConfidenceLevel } from "@/brain/confidence/derive";
import { isNonBlockingSecretClassification } from "@/features/security-scanner/rules/secret-classification";

const GROUP_PATTERNS: Array<{
  pattern: RegExp;
  title: string;
  category: string;
}> = [
  {
    pattern: /auth|login|session|jwt|oauth|middleware/i,
    title: "Harden authentication and session handling",
    category: "authentication",
  },
  {
    pattern: /authoriz|ownership|permission|access control|rls|policy/i,
    title: "Protect resource ownership checks",
    category: "authorization",
  },
  {
    pattern: /secret|credential|api.?key|token|password/i,
    title: "Revoke exposed credentials and rotate secrets",
    category: "data_protection",
  },
  {
    pattern: /rate.?limit|throttle|dos/i,
    title: "Add rate limiting to sensitive endpoints",
    category: "deployment",
  },
  {
    pattern: /admin|privileged|elevated/i,
    title: "Protect admin endpoints and privileged routes",
    category: "authorization",
  },
  {
    pattern: /sql|injection|xss|csrf/i,
    title: "Fix injection and input validation risks",
    category: "security",
  },
  {
    pattern: /env|config|deployment|vercel|supabase/i,
    title: "Fix deployment and environment configuration",
    category: "deployment",
  },
];

function groupKey(finding: NormalizedFinding): string {
  for (const group of GROUP_PATTERNS) {
    if (group.pattern.test(`${finding.title} ${finding.category} ${finding.ruleId ?? ""}`)) {
      return group.title;
    }
  }
  return finding.title;
}

function severityWeight(severity: NormalizedFinding["severity"]): number {
  switch (severity) {
    case "critical":
      return 100;
    case "high":
      return 70;
    case "medium":
      return 30;
    case "low":
      return 10;
    default:
      return 0;
  }
}

function confidenceWeight(finding: NormalizedFinding): number {
  return isHighConfidenceLevel(finding.confidenceLevel) ? 1 : finding.confidenceLevel === "INFERRED" ? 0.7 : 0.4;
}

export function selectTopPriorities(findings: NormalizedFinding[]): ProductionPriority[] {
  const blockers = findings.filter(
    (f) =>
      (f.severity === "critical" || f.severity === "high") &&
      !isNonBlockingSecretClassification(f.secretClassification)
  );
  const candidates = blockers.length > 0 ? blockers : findings.filter((f) => f.severity === "medium");

  const groups = new Map<
    string,
    {
      title: string;
      category: string;
      findings: NormalizedFinding[];
      score: number;
    }
  >();

  for (const finding of candidates) {
    const key = groupKey(finding);
    const groupMeta = GROUP_PATTERNS.find((g) => g.title === key);
    const existing = groups.get(key) ?? {
      title: groupMeta?.title ?? finding.title,
      category: groupMeta?.category ?? finding.category,
      findings: [],
      score: 0,
    };
    existing.findings.push(finding);
    existing.score +=
      severityWeight(finding.severity) *
      confidenceWeight(finding) *
      (finding.filePath ? 1.1 : 1);
    groups.set(key, existing);
  }

  const sorted = Array.from(groups.values()).sort((a, b) => b.score - a.score).slice(0, 3);

  return sorted.map((group, index) => {
    const topFinding = group.findings.sort(
      (a, b) => severityWeight(b.severity) - severityWeight(a.severity)
    )[0];
    const files = Array.from(
      new Set(group.findings.map((f) => f.filePath).filter((f): f is string => Boolean(f)))
    );

    return {
      id: `priority-${index + 1}-${group.category}`,
      rank: index + 1,
      title: group.title,
      category: group.category,
      reason: `${group.findings.length} related finding${group.findings.length === 1 ? "" : "s"} affect production readiness.`,
      severity: topFinding.severity,
      confidence: topFinding.confidence,
      confidenceLevel: topFinding.confidenceLevel,
      estimatedMinutes: 0, // filled by fix-time module
      estimatedTimeLabel: "",
      projectedScoreImpact: 0, // filled by projection module
      affectedFiles: files.slice(0, 5),
      recommendedAction:
        topFinding.recommendation ??
        `Review and fix ${group.title.toLowerCase()} before shipping.`,
      findingIds: group.findings.map((f) => f.id),
    };
  });
}
