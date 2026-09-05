export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Confidence = "high" | "medium" | "low";

export interface InputFile {
  path: string;
  content: string;
}

export interface NormalizedFile extends InputFile {
  path: string;
  extension: string;
  lines: string[];
  bytes: number;
}

export interface FindingLocation {
  path: string;
  line: number;
  column?: number;
}

export interface Finding {
  id: string;
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  confidence: Confidence;
  category: string;
  location: FindingLocation;
  evidence?: string;
  remediation: string;
  fingerprint: string;
  /** Line-independent identity for local ↔ GitHub correlation (Phase D.7). */
  correlationKey: string;
  metadata?: Record<string, unknown>;
}

export interface FindingDraft extends Omit<Finding, "id" | "fingerprint" | "correlationKey"> {
  fingerprintMaterial?: string;
}

export interface StackProfile {
  languages: string[];
  frameworks: string[];
  services: string[];
  packageManagers: string[];
  dependencies: Record<string, string>;
}

export interface ScoreBreakdown {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  deductions: Record<Severity, number>;
  counts: Record<Severity, number>;
}

export interface ScanOmission {
  path?: string;
  reason: "invalid-path" | "ignored" | "binary" | "file-too-large" | "total-limit" | "time-limit" | "rule-error";
  detail?: string;
  ruleId?: string;
}

export interface ScanMetrics {
  inputFiles: number;
  scannedFiles: number;
  scannedBytes: number;
  omittedFiles: number;
  rulesRun: number;
  ruleFailures: number;
  findingsBeforeDeduplication: number;
  findings: number;
  durationMs: number;
  truncated: boolean;
  /**
   * Phase 23 -- aggregate dependency-registry telemetry (Phase 22), best-
   * effort attached here so it rides along with the metrics every scan
   * already persists (scans.metrics). Absent if package-security.scan-
   * packages didn't run, was skipped, or metrics capture itself failed --
   * never required for a scan to be considered successful.
   */
  registryMetrics?: unknown;
}

export interface ScanResult {
  findings: Finding[];
  stack: StackProfile;
  score: ScoreBreakdown;
  omissions: ScanOmission[];
  metrics: ScanMetrics;
}
