import { assessCoverage, hasSufficientCoverage } from "./coverage";
import { applyFixTimeEstimates, totalEstimatedMinutes } from "./fix-time";
import { normalizeFinding, type NormalizedFinding } from "./normalize-finding";
import { selectTopPriorities } from "./priorities";
import {
  applyProjectedImpacts,
  calculateHonestScore,
  projectScoreAfterPriorities,
} from "./projection";
import { isNonBlockingSecretClassification } from "@/features/security-scanner/rules/secret-classification";
import {
  PRODUCTION_VERDICT_VERSION,
  ProductionVerdictSchema,
  type ProductionVerdictV1,
} from "./schema";
import {
  buildDeterministicSummary,
  buildMethodologyNote,
} from "./summary";
import {
  determineVerdictStatus,
  overallConfidence,
  recommendedAction,
  verdictHeadline,
} from "./status-rules";

export type VerdictEngineInput = {
  projectId: string;
  repositoryId: string;
  scanId: string;
  commitSha?: string | null;
  branch?: string | null;
  scanStatus: string;
  securityScore: number | null;
  filesAnalyzed?: number;
  filesDiscovered?: number;
  findings: Array<{
    id?: string;
    title: string;
    severity?: string | null;
    category?: string | null;
    rule_id?: string | null;
    rule?: string | null;
    file_path?: string | null;
    start_line?: number | null;
    recommendation?: string | null;
    confidence?: string | number | null;
    evidence?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  previousScore?: number | null;
  previousBlockersCount?: number;
  partialScanFailure?: boolean;
  aiExecutiveSummary?: string | null;
};

export type VerdictGenerationMeta = {
  engineVersion: string;
  findingCount: number;
  normalizedFindingCount: number;
};

function countBlockers(findings: NormalizedFinding[]) {
  const blockers = findings.filter(
    (finding) =>
      (finding.severity === "critical" || finding.severity === "high") &&
      !isNonBlockingSecretClassification(finding.secretClassification)
  );
  const critical = blockers.filter((f) => f.severity === "critical").length;
  const high = blockers.filter((f) => f.severity === "high").length;
  return {
    blockersCount: critical + high,
    criticalBlockersCount: critical,
    highBlockersCount: high,
  };
}

function blockerDelta(current: number, previous?: number) {
  if (previous == null) return { introduced: 0, resolved: 0 };
  if (current > previous) {
    return { introduced: current - previous, resolved: 0 };
  }
  if (current < previous) {
    return { introduced: 0, resolved: previous - current };
  }
  return { introduced: 0, resolved: 0 };
}

export function generateProductionVerdict(input: VerdictEngineInput): {
  verdict: ProductionVerdictV1;
  meta: VerdictGenerationMeta;
} {
  const normalized = input.findings.map(normalizeFinding);
  const filesAnalyzed = input.filesAnalyzed ?? 0;
  const blockers = countBlockers(normalized);

  const coverage = assessCoverage({
    findings: normalized,
    securityScore: input.securityScore,
    filesAnalyzed,
  });

  const sufficientCoverage = hasSufficientCoverage({
    filesAnalyzed,
    coverageRatio: coverage.coverageRatio,
    scanStatus: input.scanStatus,
  });

  const score = calculateHonestScore({
    securityScore: input.securityScore,
    findings: normalized,
    hasSufficientCoverage: sufficientCoverage,
  });

  const status = determineVerdictStatus({
    scanStatus: input.scanStatus,
    score,
    criticalBlockersCount: blockers.criticalBlockersCount,
    highBlockersCount: blockers.highBlockersCount,
    hasSufficientCoverage: sufficientCoverage,
    findings: normalized,
    partialScanFailure: input.partialScanFailure,
  });

  let priorities = applyFixTimeEstimates(selectTopPriorities(normalized));
  const projection = projectScoreAfterPriorities({
    currentScore: score,
    securityScore: input.securityScore,
    allFindings: normalized,
    priorities,
  });
  priorities = applyProjectedImpacts(priorities, projection.impacts);

  const scoreDelta =
    input.previousScore != null && score != null ? score - input.previousScore : null;

  const { introduced, resolved } = blockerDelta(
    blockers.blockersCount,
    input.previousBlockersCount
  );

  const baseVerdict: ProductionVerdictV1 = {
    version: PRODUCTION_VERDICT_VERSION,
    projectId: input.projectId,
    repositoryId: input.repositoryId,
    scanId: input.scanId,
    commitSha: input.commitSha ?? null,
    branch: input.branch ?? null,
    status,
    score,
    previousScore: input.previousScore ?? null,
    scoreDelta,
    projectedScore: projection.projectedScore,
    projectedScoreIsEstimate: true,
    blockersCount: blockers.blockersCount,
    criticalBlockersCount: blockers.criticalBlockersCount,
    highBlockersCount: blockers.highBlockersCount,
    estimatedFixMinutes: totalEstimatedMinutes(priorities),
    confidence: overallConfidence({
      status,
      filesAnalyzed,
      findingsCount: normalized.length,
    }),
    executiveSummary: "",
    topPriorities: priorities,
    evaluatedAreas: coverage.evaluatedAreas,
    partiallyEvaluatedAreas: coverage.partiallyEvaluatedAreas,
    unevaluatedAreas: coverage.unevaluatedAreas,
    introducedBlockers: introduced,
    resolvedBlockers: resolved,
    coverageRatio: coverage.coverageRatio,
    filesAnalyzed,
    findingsCount: normalized.length,
    recommendedAction: recommendedAction(status, blockers.blockersCount),
    methodologyNote: "",
    generatedAt: new Date().toISOString(),
  };

  baseVerdict.executiveSummary =
    input.aiExecutiveSummary?.trim() || buildDeterministicSummary(baseVerdict);
  baseVerdict.methodologyNote = buildMethodologyNote(baseVerdict);

  const verdict = ProductionVerdictSchema.parse(baseVerdict);

  return {
    verdict,
    meta: {
      engineVersion: PRODUCTION_VERDICT_VERSION,
      findingCount: input.findings.length,
      normalizedFindingCount: normalized.length,
    },
  };
}

export { verdictHeadline };
