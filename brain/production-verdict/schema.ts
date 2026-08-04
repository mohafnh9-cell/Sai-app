import { z } from "zod";

export const PRODUCTION_VERDICT_VERSION = "1.0.0";

export const VerdictStatusSchema = z.enum([
  "ready_to_ship",
  "almost_ready",
  "needs_improvement",
  "not_ready",
  "insufficient_data",
  "analysis_failed",
]);

export type VerdictStatus = z.infer<typeof VerdictStatusSchema>;

export const VERDICT_STATUS_LABELS: Record<VerdictStatus, string> = {
  ready_to_ship: "Ready to Ship",
  almost_ready: "Almost Ready",
  needs_improvement: "Needs Improvement",
  not_ready: "Not Ready to Ship",
  insufficient_data: "More Analysis Required",
  analysis_failed: "Analysis Failed",
};

export const AreaKeySchema = z.enum([
  "security",
  "authentication",
  "authorization",
  "data_protection",
  "dependencies",
  "architecture",
  "testing",
  "performance",
  "deployment",
  "observability",
  "database",
  "reliability",
]);

export type AreaKey = z.infer<typeof AreaKeySchema>;

export const AreaStatusSchema = z.enum(["evaluated", "partial", "not_evaluated"]);

export const ProductionAreaAssessmentSchema = z.object({
  key: AreaKeySchema,
  label: z.string(),
  status: AreaStatusSchema,
  score: z.number().min(0).max(100).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  evidenceCount: z.number().int().min(0),
  methodology: z.string(),
  limitations: z.string().optional(),
});

export type ProductionAreaAssessment = z.infer<typeof ProductionAreaAssessmentSchema>;

export const ProductionPrioritySchema = z.object({
  id: z.string(),
  rank: z.number().int().min(1).max(3),
  title: z.string(),
  category: z.string(),
  reason: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  confidence: z.enum(["high", "medium", "low"]),
  estimatedMinutes: z.number().int().min(0),
  estimatedTimeLabel: z.string(),
  projectedScoreImpact: z.number().min(0).max(100),
  affectedFiles: z.array(z.string()),
  recommendedAction: z.string(),
  findingIds: z.array(z.string()),
});

export type ProductionPriority = z.infer<typeof ProductionPrioritySchema>;

export const ProductionVerdictSchema = z.object({
  version: z.string(),
  projectId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  scanId: z.string().uuid(),
  commitSha: z.string().nullable(),
  branch: z.string().nullable(),

  status: VerdictStatusSchema,
  score: z.number().min(0).max(100).nullable(),
  previousScore: z.number().min(0).max(100).nullable(),
  scoreDelta: z.number().nullable(),
  projectedScore: z.number().min(0).max(100).nullable(),
  projectedScoreIsEstimate: z.boolean(),

  blockersCount: z.number().int().min(0),
  criticalBlockersCount: z.number().int().min(0),
  highBlockersCount: z.number().int().min(0),

  estimatedFixMinutes: z.number().int().min(0),
  confidence: z.enum(["high", "medium", "low"]),

  executiveSummary: z.string(),
  topPriorities: z.array(ProductionPrioritySchema).max(3),

  evaluatedAreas: z.array(ProductionAreaAssessmentSchema),
  partiallyEvaluatedAreas: z.array(ProductionAreaAssessmentSchema),
  unevaluatedAreas: z.array(ProductionAreaAssessmentSchema),

  introducedBlockers: z.number().int().min(0),
  resolvedBlockers: z.number().int().min(0),

  coverageRatio: z.number().min(0).max(1).nullable(),
  filesAnalyzed: z.number().int().min(0),
  findingsCount: z.number().int().min(0),

  recommendedAction: z.string(),
  methodologyNote: z.string(),

  generatedAt: z.string().datetime(),

  /** Unified platform convergence — authoritative decision linkage */
  correlationId: z.string().uuid().optional(),
  scanExecutionId: z.string().uuid().optional(),
  securityDecisionId: z.string().uuid().optional(),
  securityDeploymentVerdict: z.string().optional(),
  attackSimulation: z
    .object({
      campaignId: z.string().uuid().nullable(),
      campaignStatus: z.string(),
      totalExecutions: z.number().int().min(0),
      confirmedFindings: z.number().int().min(0),
      notExploitableFindings: z.number().int().min(0),
      protectedExecutions: z.number().int().min(0),
      stillVulnerableExecutions: z.number().int().min(0),
      blockedExecutions: z.number().int().min(0),
      pendingReplay: z.number().int().min(0),
      headline: z.string(),
    })
    .optional(),
});

export type ProductionVerdictV1 = z.infer<typeof ProductionVerdictSchema>;

export function parseProductionVerdict(data: unknown): ProductionVerdictV1 {
  return ProductionVerdictSchema.parse(data);
}

export function safeParseProductionVerdict(data: unknown): ProductionVerdictV1 | null {
  const result = ProductionVerdictSchema.safeParse(data);
  return result.success ? result.data : null;
}
