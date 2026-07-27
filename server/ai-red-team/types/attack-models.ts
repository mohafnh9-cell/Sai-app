import type { AttackDomain } from "./application-context";

export type AttackSeverity = "info" | "low" | "medium" | "high" | "critical";

export type AttackEvidence = {
  id: string;
  kind: string;
  label: string;
  detail?: string | null;
  artifactRef?: string | null;
  capturedAt: string;
  metadata?: Record<string, unknown>;
};

export type AttackFinding = {
  id: string;
  title: string;
  description: string;
  domain: AttackDomain;
  severity: AttackSeverity;
  confidence: number;
  evidenceIds: string[];
  metadata?: Record<string, unknown>;
};

export type AttackResultStatus = "completed" | "skipped" | "failed" | "cancelled" | "timed_out";

export type AttackResult = {
  agentId: string;
  agentName: string;
  domain: AttackDomain;
  status: AttackResultStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  findings: AttackFinding[];
  evidence: AttackEvidence[];
  logs: string[];
  error?: string | null;
  metadata?: Record<string, unknown>;
};

export type AttackExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export type AttackExecution = {
  executionId: string;
  agentId: string;
  planPhaseId: string;
  status: AttackExecutionStatus;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  result?: AttackResult | null;
  error?: string | null;
};

export type AttackSummary = {
  totalAgents: number;
  completed: number;
  skipped: number;
  failed: number;
  cancelled: number;
  timedOut: number;
  totalFindings: number;
  totalDurationMs: number;
  domainsCovered: AttackDomain[];
};
