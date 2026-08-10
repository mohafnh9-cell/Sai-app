import {
  inferSecretClassificationFromPersistedFinding,
  isNonBlockingSecretClassification,
  resolveSecretClassification,
  SECRET_CLASSIFICATION_METADATA_KEY,
  type SecretEvidenceClassification,
} from "@/features/security-scanner/rules/secret-classification";

export {
  inferSecretClassificationFromPersistedFinding,
  resolveSecretClassification,
  SECRET_CLASSIFICATION_METADATA_KEY,
};

export function secretClassificationFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): SecretEvidenceClassification | undefined {
  const value = metadata?.[SECRET_CLASSIFICATION_METADATA_KEY];
  if (typeof value !== "string") return undefined;
  return value as SecretEvidenceClassification;
}

export function isNonBlockingSecretFinding(input: {
  ruleId?: string | null;
  file_path?: string | null;
  filePath?: string | null;
  evidence?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if ((input.ruleId ?? "").toLowerCase() !== "secrets.exposed") return false;
  const classification = resolveSecretClassification({
    ruleId: input.ruleId,
    filePath: input.filePath ?? input.file_path ?? null,
    evidence: input.evidence ?? null,
    metadata: input.metadata ?? null,
  });
  return isNonBlockingSecretClassification(classification);
}
