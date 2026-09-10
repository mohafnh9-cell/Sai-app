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
import { deriveExploitability, type CanonicalEvidence, type SequrAIFinding } from "@/server/security-evidence/canonical-finding";
import { runCryptoRules } from "./rules";

const CRYPTO_ENGINE_VERSION = "1.0.0";
const SOURCE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".rb", ".java"];

export function createCryptoEngine(): SecurityEngine {
  return {
    id: "crypto",
    name: "SequrAI Native Cryptography Engine",
    version: CRYPTO_ENGINE_VERSION,
    capabilities: [
      { id: "cryptography", engine: "crypto", expensive: false, networkRequired: false, requiresExternalBinary: false },
    ],

    applicability(input: EngineApplicabilityInput): EngineApplicabilityResult {
      const applicableFiles = input.files.filter((f) => SOURCE_EXTENSIONS.some((ext) => f.path.endsWith(ext)));
      if (applicableFiles.length === 0) {
        return { applicable: false, reason: "no source files in a supported language", matchedCapabilities: [] };
      }
      return { applicable: true, reason: `${applicableFiles.length} source file(s) found`, matchedCapabilities: ["cryptography"] };
    },

    async healthCheck(): Promise<EngineHealthCheckResult> {
      // Pure in-process TypeScript -- no external process, always healthy.
      return { healthy: true, reason: "native engine, no external dependency", detectedVersion: CRYPTO_ENGINE_VERSION };
    },

    async execute(input: EngineExecuteInput): Promise<EngineResult> {
      const executionId = randomUUID();
      const startedAt = new Date().toISOString();
      const started = Date.now();
      const now = new Date().toISOString();

      const filesWithContent = input.files.filter((f) => SOURCE_EXTENSIONS.some((ext) => f.path.endsWith(ext)));
      const matches = runCryptoRules(filesWithContent);

      const findings: SequrAIFinding[] = [];
      const evidence: CanonicalEvidence[] = [];

      for (const match of matches) {
        const evidenceItem: CanonicalEvidence = {
          id: randomUUID(),
          kind: "SOURCE_CODE",
          label: `${match.ruleId} at ${match.path}:${match.line}`,
          detail: match.snippet,
          redacted: false,
          capturedAt: now,
        };
        evidence.push(evidenceItem);

        const fingerprint = createHash("sha256").update(`crypto:${match.ruleId}:${match.path}:${match.line}`).digest("hex").slice(0, 32);
        const verificationStatus = "POTENTIAL" as const;

        findings.push({
          id: `crypto:${fingerprint}`,
          fingerprint,
          title: `${match.ruleId}: ${match.message.split(".")[0]?.slice(0, 120) ?? match.message.slice(0, 120)}`,
          description: match.message,
          category: "cryptography",
          severity: match.severity,
          confidence: "medium",
          exploitability: deriveExploitability({ verificationStatus, severity: match.severity, evidence: [evidenceItem] }),
          verificationStatus,
          sources: ["native_scanner"],
          evidence: [evidenceItem],
          affectedFiles: [match.path],
          affectedEndpoints: [],
          affectedAssets: [],
          remediation: match.remediation,
          references: [],
          cwe: match.cwe,
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
        engine: "crypto",
        engineVersion: CRYPTO_ENGINE_VERSION,
        executionId,
        scanId: input.scanId,
        projectId: input.projectId,
        organizationId: input.organizationId,
        status: "COMPLETED",
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        capabilitiesAttempted: ["cryptography"],
        capabilitiesCompleted: ["cryptography"],
        findings,
        evidence,
        metrics: { filesScanned: filesWithContent.length, matchesFound: matches.length },
        errors: [],
      };
    },
  };
}
