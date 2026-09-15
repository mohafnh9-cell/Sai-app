import "server-only";

import type { CanonicalEvidence, EvidenceKind, SequrAIFinding } from "@/server/security-evidence/canonical-finding";

/**
 * Phase 35: the multi-engine abstraction. A "SecurityEngine" is a sensor --
 * native regex rules, an external binary (OpenGrep, Trivy), or an HTTP-based
 * check (Scorecard) -- that produces normalized findings/evidence for a
 * single repository snapshot. SequrAI itself remains the orchestrator,
 * correlator, and decision-maker (Phase 34's correlation-engine/attack-chain-
 * builder/Production Verdict) -- engines never decide severity-final,
 * exploitability-final, or verdict.
 */

export type EngineId = "native" | "opengrep" | "trivy" | "crypto" | "scorecard";

export type EngineCapabilityId =
  | "secrets"
  | "authentication"
  | "authorization"
  | "injection"
  | "mcp-security"
  | "ai-security"
  | "ci-cd"
  | "ast"
  | "taint"
  | "dataflow"
  | "semantic"
  | "dependencies"
  | "containers"
  | "iac"
  | "sbom"
  | "cryptography"
  | "supply-chain-posture";

/**
 * Section 20: applicability != execution. A capability can be applicable
 * (the repo has the relevant surface) yet still end up unavailable, disabled,
 * unauthorized, timed out, or failed -- those are tracked separately by
 * EngineResult.status, never folded back into applicability itself.
 */
export type EngineCapability = {
  id: EngineCapabilityId;
  engine: EngineId;
  /** Rough cost signal for a future planner (Phase 36) -- not used to gate execution in this phase. */
  expensive: boolean;
  networkRequired: boolean;
  /** True if this capability can only run behind the external-engine worker boundary (see README-worker-boundary.md). */
  requiresExternalBinary: boolean;
};

export type EngineExecutionStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "SKIPPED";

export type EngineError = {
  code: string;
  message: string;
  /** Never a raw stack trace or raw subprocess stderr -- always redacted/summarized before this is persisted. */
};

/**
 * Section 3: the normalized per-execution result contract every engine
 * returns. CRITICAL RULE (section 3): engine failure is not a security
 * verdict. A FAILED/SKIPPED engine must never be silently read as "no
 * findings" downstream -- callers must check `status` and surface coverage
 * gaps (see server/security-engines/coverage.ts), never assume absence of a
 * finding means absence of a vulnerability.
 */
export type EngineResult = {
  engine: EngineId;
  engineVersion: string;
  executionId: string;
  scanId: string;
  projectId: string;
  organizationId: string;
  status: EngineExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  capabilitiesAttempted: EngineCapabilityId[];
  capabilitiesCompleted: EngineCapabilityId[];
  findings: SequrAIFinding[];
  evidence: CanonicalEvidence[];
  metrics: Record<string, number>;
  errors: EngineError[];
};

export type EngineApplicabilityInput = {
  files: Array<{ path: string; content?: string }>;
  githubRepo?: string | null;
};

export type EngineApplicabilityResult = {
  applicable: boolean;
  reason: string;
  matchedCapabilities: EngineCapabilityId[];
};

export type EngineHealthCheckResult = {
  healthy: boolean;
  reason: string;
  detectedVersion?: string;
};

export type EngineExecuteInput = {
  scanId: string;
  projectId: string;
  organizationId: string;
  files: Array<{ path: string; content: string }>;
  githubRepo?: string | null;
  /** Hard ceiling this engine must self-enforce; the orchestrator does not separately kill the process. */
  timeoutMs: number;
  /** L1.4: optional external cancellation, independent of timeoutMs -- an engine that runs a subprocess should pass this straight through to safeExec. Optional and backward-compatible: no existing caller needs to supply it. */
  signal?: AbortSignal;
};

/**
 * Section 2: the practical SecurityEngine interface. Deliberately minimal --
 * adding a future engine (Nuclei, ZAP, a pentest engine) means implementing
 * this interface, not touching the orchestrator.
 */
export type SecurityEngine = {
  id: EngineId;
  name: string;
  version: string;
  capabilities: EngineCapability[];
  applicability(input: EngineApplicabilityInput): EngineApplicabilityResult;
  healthCheck(): Promise<EngineHealthCheckResult>;
  execute(input: EngineExecuteInput): Promise<EngineResult>;
};

export const ALL_EVIDENCE_KINDS: EvidenceKind[] = [
  "SOURCE_CODE",
  "AST",
  "TAINT_FLOW",
  "DEPENDENCY",
  "SBOM",
  "CONFIGURATION",
  "HTTP_REQUEST",
  "HTTP_RESPONSE",
  "DYNAMIC_TEST",
  "PENTEST",
  "AI_REASONING",
  "ATTACK_CHAIN",
];
