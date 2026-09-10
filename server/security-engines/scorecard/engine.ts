import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type {
  EngineApplicabilityInput,
  EngineApplicabilityResult,
  EngineExecuteInput,
  EngineHealthCheckResult,
  EngineResult,
  SecurityEngine,
} from "../types";
import { deriveExploitability, type CanonicalEvidence, type CanonicalSeverity, type SequrAIFinding } from "@/server/security-evidence/canonical-finding";

/**
 * Phase 35, section 17: OpenSSF Scorecard, verified against the real, live,
 * publicly-hosted REST API (https://api.securityscorecards.dev) -- no
 * binary, no auth token, works from any environment including Vercel
 * serverless (this is a plain outbound fetch). Verified live during this
 * phase: GET /projects/github.com/{owner}/{repo} returns real, current
 * check-level Scorecard data for indexed public repos, and a real 404 for a
 * repo Scorecard has not indexed (most private repos -- handled as SKIPPED,
 * never as "0 findings = safe"). Repository:
 * https://github.com/ossf/scorecard. API license: CDLA-Permissive-2.0 (data
 * license, not code -- SequrAI only reads/queries it, never redistributes
 * the raw dataset).
 */
export const SCORECARD_API_BASE = "https://api.securityscorecards.dev";
const REQUEST_TIMEOUT_MS = 8_000;
/** Only checks scoring at or below this (0-10, lower = worse) become a finding -- section 18: not the whole score becomes "VULNERABILITY". */
const WEAK_CHECK_THRESHOLD = 5;

type ScorecardCheck = { name: string; score: number; reason: string; documentation?: { url?: string } };
type ScorecardResponse = { score: number; repo: { name: string; commit: string }; checks: ScorecardCheck[] };

function severityForCheckScore(score: number): CanonicalSeverity {
  if (score <= 0) return "high";
  if (score <= 3) return "medium";
  return "low";
}

function parseGithubRepo(githubRepo: string): { owner: string; repo: string } | null {
  const match = githubRepo.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) return null;
  return { owner: match[1] as string, repo: match[2] as string };
}

export function createScorecardEngine(): SecurityEngine {
  return {
    id: "scorecard",
    name: "OpenSSF Scorecard",
    version: "api-live",
    capabilities: [
      { id: "supply-chain-posture", engine: "scorecard", expensive: false, networkRequired: true, requiresExternalBinary: false },
    ],

    applicability(input: EngineApplicabilityInput): EngineApplicabilityResult {
      if (!input.githubRepo || !parseGithubRepo(input.githubRepo)) {
        return { applicable: false, reason: "no connected GitHub repository", matchedCapabilities: [] };
      }
      return { applicable: true, reason: `GitHub repository ${input.githubRepo} available`, matchedCapabilities: ["supply-chain-posture"] };
    },

    async healthCheck(): Promise<EngineHealthCheckResult> {
      try {
        const response = await fetch(`${SCORECARD_API_BASE}/projects/github.com/ossf/scorecard`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        return { healthy: response.ok, reason: response.ok ? "Scorecard API reachable" : `Scorecard API returned ${response.status}` };
      } catch (error) {
        return { healthy: false, reason: error instanceof Error ? error.message : "Scorecard API unreachable" };
      }
    },

    async execute(input: EngineExecuteInput): Promise<EngineResult> {
      const executionId = randomUUID();
      const startedAt = new Date().toISOString();
      const started = Date.now();
      const now = new Date().toISOString();

      const base = {
        engine: "scorecard" as const,
        engineVersion: "api-live",
        executionId,
        scanId: input.scanId,
        projectId: input.projectId,
        organizationId: input.organizationId,
        startedAt,
        capabilitiesAttempted: ["supply-chain-posture"] as EngineResult["capabilitiesAttempted"],
      };

      const parsed = input.githubRepo ? parseGithubRepo(input.githubRepo) : null;
      if (!parsed) {
        return {
          ...base,
          status: "SKIPPED",
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
          capabilitiesCompleted: [],
          findings: [],
          evidence: [],
          metrics: {},
          errors: [{ code: "not_applicable", message: "no connected GitHub repository to query" }],
        };
      }

      try {
        const response = await fetch(`${SCORECARD_API_BASE}/projects/github.com/${parsed.owner}/${parsed.repo}`, {
          signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, input.timeoutMs)),
        });

        if (response.status === 404) {
          return {
            ...base,
            status: "SKIPPED",
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - started,
            capabilitiesCompleted: [],
            findings: [],
            evidence: [],
            metrics: {},
            errors: [{ code: "not_indexed", message: "OpenSSF Scorecard has not indexed this repository (common for private repos)" }],
          };
        }
        if (!response.ok) {
          return {
            ...base,
            status: "FAILED",
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - started,
            capabilitiesCompleted: [],
            findings: [],
            evidence: [],
            metrics: {},
            errors: [{ code: "http_error", message: `Scorecard API returned ${response.status}` }],
          };
        }

        const data = (await response.json()) as ScorecardResponse;
        const findings: SequrAIFinding[] = [];
        const evidence: CanonicalEvidence[] = [];

        for (const check of data.checks ?? []) {
          if (check.score > WEAK_CHECK_THRESHOLD || check.score < 0) continue; // -1 = "not applicable" per Scorecard's own convention

          const evidenceItem: CanonicalEvidence = {
            id: randomUUID(),
            kind: "CONFIGURATION",
            label: `Scorecard check "${check.name}": ${check.score}/10`,
            detail: check.reason,
            redacted: false,
            capturedAt: now,
          };
          evidence.push(evidenceItem);

          const severity = severityForCheckScore(check.score);
          const verificationStatus = "POTENTIAL" as const;
          const fingerprint = createHash("sha256").update(`scorecard:${input.githubRepo}:${check.name}`).digest("hex").slice(0, 32);

          findings.push({
            id: `scorecard:${fingerprint}`,
            fingerprint,
            title: `Supply-chain posture weakness: ${check.name}`,
            description: check.reason,
            category: "supply-chain-posture",
            severity,
            confidence: "medium",
            exploitability: deriveExploitability({ verificationStatus, severity, evidence: [evidenceItem] }),
            verificationStatus,
            sources: ["external_engine"],
            evidence: [evidenceItem],
            affectedFiles: [],
            affectedEndpoints: [],
            affectedAssets: [`github.com/${parsed.owner}/${parsed.repo}`],
            remediation: `See the Scorecard "${check.name}" check documentation for the specific remediation steps.`,
            references: check.documentation?.url ? [check.documentation.url] : [],
            cwe: [],
            owasp: [],
            mitre: [],
            scanId: input.scanId,
            projectId: input.projectId,
            organizationId: input.organizationId,
            createdAt: now,
            updatedAt: now,
          });
        }

        return {
          ...base,
          status: "COMPLETED",
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
          capabilitiesCompleted: ["supply-chain-posture"],
          findings,
          evidence,
          metrics: { overallScore: data.score, weakChecksFound: findings.length },
          errors: [],
        };
      } catch (error) {
        return {
          ...base,
          status: "FAILED",
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
          capabilitiesCompleted: [],
          findings: [],
          evidence: [],
          metrics: {},
          errors: [{ code: "request_failed", message: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  };
}
