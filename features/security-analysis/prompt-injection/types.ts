export type PromptRawSeverity = "ERROR" | "WARNING" | "INFO";

export type PromptInjectionTier =
  | "potential-pattern"
  | "suspicious-construction"
  | "likely-exploitable";

export type PromptRawFinding = {
  rule: string;
  severity: PromptRawSeverity;
  category: string;
  message: string;
  file: string;
  line: number;
  match?: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  action: "BLOCK" | "WARN" | "ALLOW";
  tier: PromptInjectionTier;
  riskScore?: number;
};

export type PromptScanResult = {
  findings: PromptRawFinding[];
  filesScanned: number;
  filesConsidered: number;
};

export type PromptCodeRule = {
  id: string;
  severity: PromptRawSeverity;
  category: string;
  message: string;
  pattern: RegExp;
  fileTypes: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  tier: PromptInjectionTier;
  requiresUntrustedInput?: boolean;
  action?: "BLOCK" | "WARN" | "ALLOW";
};

export type PromptContentRule = {
  id: string;
  severity: PromptRawSeverity;
  category: string;
  message: string;
  patterns: RegExp[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  action?: "BLOCK" | "WARN" | "ALLOW";
};

export type FileContextKind =
  | "documentation"
  | "test"
  | "fixture"
  | "comment"
  | "llm-construction"
  | "prompt-literal"
  | "source";

export type FileContext = {
  kind: FileContextKind;
  isLlmRelated: boolean;
  suppressContentRules: boolean;
  confidenceMultiplier: number;
};
