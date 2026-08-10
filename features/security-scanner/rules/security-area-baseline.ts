import type { FindingDraft } from "../types";
import type { ScanRule } from "./types";

type SecurityArea =
  | "authentication"
  | "authorization"
  | "secrets"
  | "database"
  | "api"
  | "web"
  | "cicd"
  | "dependencies";

const AREA_PATTERNS: Record<SecurityArea, RegExp> = {
  authentication: /(?:auth|login|signin|signup|session|jwt|oauth|password|magic-link)/i,
  authorization: /(?:authz|rbac|permission|role|admin|ownership|tenant|organization)/i,
  secrets: /(?:secret|credential|api[_-]?key|\.env|token)/i,
  database: /(?:\.sql|supabase|postgres|prisma|drizzle|rls|migration)/i,
  api: /(?:^|\/)(?:api|routes?|handlers?)(?:\/|$)|route\.[jt]s$/i,
  web: /\.(?:jsx|tsx|html)$|(?:^|\/)app\//i,
  cicd: /^\.github\/workflows\/.+\.ya?ml$/i,
  dependencies: /(?:^|\/)package\.json$|(?:^|\/)package-lock\.json$|(?:^|\/)pnpm-lock\.yaml$/i,
};

function pushAreaBaseline(
  findings: FindingDraft[],
  area: SecurityArea,
  path: string,
  signal: string
) {
  findings.push({
    ruleId: "security.area-baseline",
    title: `${area} coverage evaluated`,
    description: `Static security rules analyzed ${area}-related signals in the repository.`,
    severity: "info",
    confidence: "high",
    category: "architecture",
    location: { path, line: 1 },
    evidence: `area=${area};level=evaluated;signal=${signal}`,
    remediation: "Re-run Production Review after significant changes in this area.",
    fingerprintMaterial: `${area}:evaluated`,
    metadata: { securityArea: area, readinessLevel: "evaluated" },
  });
}

export const securityAreaBaselineRule: ScanRule = {
  id: "security.area-baseline",
  title: "Security area coverage baselines",
  run: ({ files }) => {
    if (files.length === 0) return [];
    const paths = files.map((file) => file.path);
    const anchor = paths[0] ?? "repository";
    const findings: FindingDraft[] = [];
    const seen = new Set<SecurityArea>();

    for (const file of files) {
      for (const [area, pattern] of Object.entries(AREA_PATTERNS) as Array<
        [SecurityArea, RegExp]
      >) {
        if (seen.has(area)) continue;
        if (!pattern.test(file.path) && !pattern.test(file.content.slice(0, 4000))) continue;
        seen.add(area);
        pushAreaBaseline(findings, area, file.path, file.path);
      }
    }

    if (findings.length === 0) {
      pushAreaBaseline(findings, "api", anchor, "repository-scan");
    }

    return findings;
  },
};
