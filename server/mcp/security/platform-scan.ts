import type { Finding, NormalizedFile } from "@/features/security-scanner/types";
import { findingFingerprint } from "@/features/security-scanner/fingerprint";
import { buildFindingCorrelationKey } from "@/lib/correlation/finding-identity";
import { guardUntrustedInput, scanInjectionPatterns } from "./input-guard";
import {
  platformInjectionFingerprintMaterial,
  platformInjectionToFindingDraft,
  type PlatformInjectionDetection,
} from "./platform-finding";

const README_LIKE = /\.(md|markdown|txt)$/i;
const COMMIT_MESSAGE_LIKE = /(commit|changelog|history)/i;

function draftToFinding(
  draft: ReturnType<typeof platformInjectionToFindingDraft>,
  detection: PlatformInjectionDetection
): Finding {
  const material = platformInjectionFingerprintMaterial(detection);
  const fingerprint = findingFingerprint(
    draft.ruleId,
    draft.location.path,
    draft.location.line,
    material
  );

  return {
    id: `platform-${fingerprint}`,
    fingerprint,
    correlationKey: buildFindingCorrelationKey({
      ruleId: draft.ruleId,
      filePath: draft.location.path,
      fingerprintMaterial: material,
    }),
    ...draft,
  };
}

function scanFindingFields(finding: Finding): PlatformInjectionDetection[] {
  const path = finding.location?.path ?? null;
  const fields: Array<[string, string | undefined]> = [
    ["title", finding.title],
    ["description", finding.description],
    ["evidence", finding.evidence],
    ["remediation", finding.remediation],
  ];

  return fields.flatMap(([field, value]) => {
    if (!value?.trim()) return [];
    return scanInjectionPatterns(value, {
      source: "finding_field",
      path: path ? `${path}#${field}` : field,
    });
  });
}

function scanRepositoryFiles(files: readonly NormalizedFile[]): PlatformInjectionDetection[] {
  return files.flatMap((file) => {
    const source = README_LIKE.test(file.path)
      ? ("repository_file" as const)
      : COMMIT_MESSAGE_LIKE.test(file.path)
        ? ("commit_history" as const)
        : null;
    if (!source) return [];

    return scanInjectionPatterns(file.content, { source, path: file.path });
  });
}

/**
 * Collect platform-side prompt injection findings from untrusted repository surfaces.
 * Does not block analysis — marks, isolates, and surfaces manipulation attempts.
 */
export function collectPlatformInjectionFindings(
  findings: readonly Finding[],
  normalizedFiles?: readonly NormalizedFile[]
): Finding[] {
  const detections: PlatformInjectionDetection[] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    for (const detection of scanFindingFields(finding)) {
      const key = platformInjectionFingerprintMaterial(detection);
      if (seen.has(key)) continue;
      seen.add(key);
      detections.push(detection);
    }
  }

  if (normalizedFiles?.length) {
    for (const detection of scanRepositoryFiles(normalizedFiles)) {
      const key = platformInjectionFingerprintMaterial(detection);
      if (seen.has(key)) continue;
      seen.add(key);
      detections.push(detection);
    }
  }

  return detections.map((detection) =>
    draftToFinding(platformInjectionToFindingDraft(detection), detection)
  );
}

export function wrapRepositoryContentForPrompt(
  content: string,
  options: Parameters<typeof guardUntrustedInput>[1]
): string {
  return guardUntrustedInput(content, { ...options, forceWrap: true }).forPrompt;
}
