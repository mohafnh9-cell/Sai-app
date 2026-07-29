import type { FindingDraft } from "../types";
import type { ScanRule } from "./types";

type ReadinessArea = "dependencies" | "testing" | "performance" | "observability" | "reliability";
type ReadinessLevel = "partial" | "evaluated";

function pushBaseline(
  findings: FindingDraft[],
  area: ReadinessArea,
  level: ReadinessLevel,
  title: string,
  description: string,
  path: string
) {
  findings.push({
    ruleId: "readiness.area-baseline",
    title,
    description,
    severity: "info",
    confidence: "high",
    category: area,
    location: { path, line: 1 },
    evidence: `area=${area};level=${level}`,
    remediation: "Keep monitoring this area on each production review.",
    fingerprintMaterial: `${area}:${level}`,
    metadata: {
      readinessArea: area,
      readinessLevel: level,
    },
  });
}

function countMatches(paths: string[], pattern: RegExp): number {
  return paths.filter((path) => pattern.test(path)).length;
}

export const readinessAreasRule: ScanRule = {
  id: "readiness.area-baseline",
  title: "Production readiness area baselines",
  run: ({ files }) => {
    const paths = files.map((file) => file.path);
    const findings: FindingDraft[] = [];
    const anchor = paths.find((p) => p.endsWith("package.json")) ?? "package.json";

    const hasPkg = paths.some((p) => p.endsWith("package.json"));
    const hasLock = paths.some((p) =>
      /(?:^|\/)package-lock\.json$|(?:^|\/)pnpm-lock\.yaml$|(?:^|\/)yarn\.lock$/.test(p)
    );
    if (hasPkg) {
      pushBaseline(
        findings,
        "dependencies",
        hasLock ? "evaluated" : "partial",
        hasLock ? "Dependencies lockfile present" : "Dependency manifest scanned",
        hasLock
          ? "package.json and a lockfile were analyzed for supply-chain hygiene."
          : "package.json was analyzed; add a lockfile for stronger reproducibility signals.",
        anchor
      );
    }

    const testFiles = countMatches(paths, /\.(?:test|spec)\.[cm]?tsx?$/i);
    const hasTestRunner = paths.some((p) => /vitest\.config|jest\.config/.test(p));
    if (testFiles > 0 || hasTestRunner) {
      pushBaseline(
        findings,
        "testing",
        testFiles >= 5 && hasTestRunner ? "evaluated" : "partial",
        "Automated tests detected in repository",
        `Found ${testFiles} test files${hasTestRunner ? " and a test runner config" : ""}.`,
        paths.find((p) => /\.(?:test|spec)\./.test(p)) ?? anchor
      );
    }

    const perfSignals = countMatches(
      paths,
      /server\/cache\/|operation-timing|next\.config/
    );
    if (perfSignals > 0) {
      pushBaseline(
        findings,
        "performance",
        perfSignals >= 2 ? "evaluated" : "partial",
        "Performance-oriented patterns detected",
        "Caching, timing instrumentation, or Next.js config were found in the scanned tree.",
        paths.find((p) => /next\.config/.test(p)) ?? anchor
      );
    }

    const obsSignals = countMatches(
      paths,
      /server\/observability\/|operational-events|api\/internal\/jobs\/health/
    );
    if (obsSignals > 0) {
      pushBaseline(
        findings,
        "observability",
        obsSignals >= 2 ? "evaluated" : "partial",
        "Observability hooks present",
        "Metrics, operational events, or internal health endpoints were detected.",
        paths.find((p) => p.includes("server/observability/")) ?? anchor
      );
    }

    const relSignals = countMatches(
      paths,
      /inngest\/functions\/|scan-job-recovery|server\/observability\/idempotency/
    );
    if (relSignals > 0) {
      pushBaseline(
        findings,
        "reliability",
        relSignals >= 2 ? "evaluated" : "partial",
        "Background job and recovery patterns detected",
        "Inngest workers, recovery flows, or idempotency helpers were found.",
        paths.find((p) => p.includes("scan-job-recovery")) ?? anchor
      );
    }

    return findings;
  },
};
