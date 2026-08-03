import { parseEvidenceReport } from "@/brain/evidence-finding/schema";

export type ScanSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type ScanRecord = {
  id?: string;
  scan_id?: string;
  status?: string;
  progress?: number;
  progress_message?: string | null;
  score?: number | null;
  security_score?: number | null;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  branch?: string;
  commit?: string;
  commit_sha?: string;
  files_scanned?: number;
  files_analyzed?: number;
  files_discovered?: number;
  total_files?: number;
  stack?: string | string[];
  detected_stack?: unknown;
  findings_count?: number;
  severity_counts?: Partial<Record<ScanSeverity | Lowercase<ScanSeverity>, number>>;
  error?: string;
  error_message?: string | null;
};

export type ScanFinding = {
  id?: string;
  severity?: string;
  category?: string;
  status?: string;
  confidence?: string | number;
  rule?: string;
  rule_id?: string;
  title?: string;
  description?: string;
  evidence?: string;
  impact?: string;
  recommendation?: string;
  file?: string;
  file_path?: string;
  filePath?: string;
  line?: number;
  line_number?: number;
  start_line?: number;
  lineNumber?: number;
  snippet?: string;
  code_snippet?: string;
  codeSnippet?: string;
  metadata?: Record<string, unknown> | null;
};

export const scanId = (scan: ScanRecord) => scan.id ?? scan.scan_id ?? "";
export const scanScore = (scan: ScanRecord) => scan.score ?? scan.security_score ?? null;
export const scanDate = (scan: ScanRecord) =>
  scan.completed_at ?? scan.started_at ?? scan.created_at;
export const scanCommit = (scan: ScanRecord) => scan.commit_sha ?? scan.commit;
export const findingFile = (finding: ScanFinding) =>
  finding.file_path ?? finding.filePath ?? finding.file ?? "";
export const findingLine = (finding: ScanFinding) =>
  finding.start_line ?? finding.line_number ?? finding.lineNumber ?? finding.line;
export const findingSnippet = (finding: ScanFinding) =>
  finding.code_snippet ?? finding.codeSnippet ?? finding.snippet;
export const scanStack = (scan: ScanRecord) => {
  const value = scan.detected_stack ?? scan.stack;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .flatMap((item) => (Array.isArray(item) ? item : []))
      .filter((item): item is string => typeof item === "string");
  }
  return [];
};
export const findingStatus = (finding: ScanFinding) =>
  finding.status ??
  (typeof finding.metadata?.status === "string" ? finding.metadata.status : undefined);
export const findingConfidence = (finding: ScanFinding) =>
  finding.confidence ??
  (typeof finding.metadata?.confidence === "string" ||
  typeof finding.metadata?.confidence === "number"
    ? finding.metadata.confidence
    : undefined);
export const findingEvidence = (finding: ScanFinding) =>
  finding.evidence ??
  (typeof finding.metadata?.evidence === "string" ? finding.metadata.evidence : undefined);

export const findingEvidenceReport = (finding: ScanFinding) =>
  parseEvidenceReport(finding.metadata?.evidenceReport);

export function severityCount(scan: ScanRecord, severity: ScanSeverity) {
  return (
    scan.severity_counts?.[severity] ??
    scan.severity_counts?.[severity.toLowerCase() as Lowercase<ScanSeverity>] ??
    0
  );
}

export function formatScanDate(value?: string) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
