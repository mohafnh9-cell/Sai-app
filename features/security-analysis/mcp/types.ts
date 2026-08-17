export type McpRawSeverity = "ERROR" | "WARNING" | "INFO";

export type McpRawFinding = {
  rule: string;
  severity: McpRawSeverity;
  category: string;
  message: string;
  file: string;
  line: number;
  match?: string;
};

export type McpScanTarget = {
  sourceFiles: Array<{ path: string; content: string }>;
  manifestFiles: Array<{ path: string; content: string }>;
  baselineFiles: Array<{ path: string; content: string }>;
};

export type McpScanResult = {
  targets: McpScanTarget;
  findings: McpRawFinding[];
  filesScanned: number;
};

export type McpSecurityRule = {
  id: string;
  severity: McpRawSeverity;
  category: string;
  message: string;
  pattern: RegExp;
  fileTypes: string[];
  contextCheck?: (line: string, lines: string[], lineIndex: number) => boolean;
  isSpoofingRule?: boolean;
};
