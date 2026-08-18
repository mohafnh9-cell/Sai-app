import { z } from "zod";
import type { FindingVerificationStatus } from "@/server/full-product-audit/types";
import { CONFIDENCE_LEVELS } from "@/brain/confidence/types";
import {
  AGENT_SECURITY_SCANNER_ID,
  EXTERNAL_SECURITY_SOURCE_TOOLS,
  type ExternalSecuritySourceTool,
} from "./constants";

export const externalSeveritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
export type ExternalSeverity = z.infer<typeof externalSeveritySchema>;

export const externalConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type ExternalConfidence = z.infer<typeof externalConfidenceSchema>;

export const agentActionSchema = z.enum(["ALLOW", "WARN", "BLOCK"]);
export type AgentAction = z.infer<typeof agentActionSchema>;

export const securityAnalysisFindingSchema = z.object({
  scanner: z.literal(AGENT_SECURITY_SCANNER_ID),
  sourceTool: z.enum(EXTERNAL_SECURITY_SOURCE_TOOLS),
  ruleId: z.string().min(1),
  externalRuleId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  message: z.string(),
  category: z.string().nullable(),
  severity: externalSeveritySchema,
  originalSeverity: z.string().nullable(),
  severityRank: z.number().int().min(0).max(4),
  confidence: externalConfidenceSchema,
  confidenceLevel: z.enum(CONFIDENCE_LEVELS),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  column: z.number().int().positive().nullable().optional(),
  evidence: z.string().optional(),
  remediation: z.string().optional(),
  action: agentActionSchema.nullable(),
  riskScore: z.number().nullable(),
  cwe: z.union([z.string(), z.array(z.string())]).nullable(),
  owasp: z.union([z.string(), z.array(z.string())]).nullable(),
  verificationStatus: z.custom<FindingVerificationStatus>(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SecurityAnalysisFinding = z.infer<typeof securityAnalysisFindingSchema>;

export type RawExternalFinding = Record<string, unknown>;

export function isExternalSecuritySourceTool(value: string): value is ExternalSecuritySourceTool {
  return (EXTERNAL_SECURITY_SOURCE_TOOLS as readonly string[]).includes(value);
}
