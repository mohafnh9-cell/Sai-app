import { resolveConfig, type ScanConfigInput } from "./config";
import { findingFingerprint } from "./fingerprint";
import { normalizeFiles } from "./normalization";
import { redactEvidence } from "./redaction";
import { createDefaultRegistry, RuleRegistry } from "./rules/registry";
import type { RuleContext } from "./rules/types";
import { scoreFindings } from "./scoring";
import { detectStack } from "./stack";
import { postProcessScanFindings } from "@/brain/evidence-finding/enrich-scan-finding";
import type { Finding, FindingDraft, InputFile, ScanOmission, ScanResult } from "./types";

export interface ScanOptions extends ScanConfigInput {
  registry?: RuleRegistry;
}

export async function scanRepository(files: readonly InputFile[], options: ScanOptions = {}): Promise<ScanResult> {
  const config = resolveConfig(options);
  const startedAt = config.now();
  const normalized = normalizeFiles([...files], config);
  const stack = detectStack(normalized.files);
  const omissions: ScanOmission[] = [...normalized.omissions];
  const registry = options.registry ?? createDefaultRegistry();
  const drafts: FindingDraft[] = [];
  let rulesRun = 0;
  let ruleFailures = 0;
  let timeLimited = false;

  const byPath = new Map(normalized.files.map((file) => [file.path, file]));
  const context: RuleContext = {
    files: normalized.files,
    stack,
    getFile: (path) => byPath.get(path),
  };

  for (const rule of registry.list()) {
    if (config.now() - startedAt >= config.maxDurationMs) {
      omissions.push({ reason: "time-limit", detail: `Stopped before rule ${rule.id}` });
      timeLimited = true;
      break;
    }
    try {
      const output = await rule.run(context);
      drafts.push(...output);
      rulesRun += 1;
    } catch (error) {
      ruleFailures += 1;
      omissions.push({
        reason: "rule-error",
        ruleId: rule.id,
        detail: error instanceof Error ? error.name : "Unknown rule error",
      });
    }
  }

  const allFindings = drafts.map(finalizeFinding);
  const deduped = deduplicateFindings(allFindings);
  const findings = postProcessScanFindings(
    deduped,
    normalized.files.map((file) => file.path),
    normalized.files
  );
  const durationMs = Math.max(0, config.now() - startedAt);
  return {
    findings,
    stack,
    score: scoreFindings(findings),
    omissions,
    metrics: {
      inputFiles: files.length,
      scannedFiles: normalized.files.length,
      scannedBytes: normalized.bytes,
      omittedFiles: normalized.omissions.length,
      rulesRun,
      ruleFailures,
      findingsBeforeDeduplication: allFindings.length,
      findings: findings.length,
      durationMs,
      truncated: normalized.truncated || timeLimited,
    },
  };
}

function finalizeFinding(draft: FindingDraft): Finding {
  const fingerprint = findingFingerprint(
    draft.ruleId,
    draft.location.path,
    draft.location.line,
    draft.fingerprintMaterial ?? draft.title,
  );
  const { fingerprintMaterial: _discarded, ...finding } = draft;
  return {
    ...finding,
    id: `${draft.ruleId}:${fingerprint}`,
    fingerprint,
    evidence: draft.evidence ? redactEvidence(draft.evidence) : undefined,
  };
}

export function deduplicateFindings(findings: Finding[]): Finding[] {
  const unique = new Map<string, Finding>();
  const ordered = [...findings].sort(
    (a, b) =>
      a.location.path.localeCompare(b.location.path) ||
      a.location.line - b.location.line ||
      a.ruleId.localeCompare(b.ruleId),
  );
  for (const finding of ordered) {
    const nearbyDuplicate = [...unique.values()].some(
      (existing) =>
        existing.ruleId === finding.ruleId &&
        existing.title === finding.title &&
        existing.location.path === finding.location.path &&
        Math.abs(existing.location.line - finding.location.line) <= 1,
    );
    if (!nearbyDuplicate && !unique.has(finding.fingerprint)) {
      unique.set(finding.fingerprint, finding);
    }
  }
  return [...unique.values()].sort(
    (a, b) =>
      a.location.path.localeCompare(b.location.path) ||
      a.location.line - b.location.line ||
      a.ruleId.localeCompare(b.ruleId),
  );
}
