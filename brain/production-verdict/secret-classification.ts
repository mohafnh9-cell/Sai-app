import type { SecretEvidenceClassification } from "@/features/security-scanner/rules/secret-classification";
import {
  isNonBlockingSecretClassification,
  SECRET_CLASSIFICATION_METADATA_KEY,
} from "@/features/security-scanner/rules/secret-classification";

export function secretClassificationFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): SecretEvidenceClassification | undefined {
  const value = metadata?.[SECRET_CLASSIFICATION_METADATA_KEY];
  if (typeof value !== "string") return undefined;
  return value as SecretEvidenceClassification;
}

export function isNonBlockingSecretFinding(input: {
  ruleId?: string | null;
  severity?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if ((input.ruleId ?? "").toLowerCase() !== "secrets.exposed") return false;
  const classification = secretClassificationFromMetadata(input.metadata ?? null);
  return isNonBlockingSecretClassification(classification);
}
