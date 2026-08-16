import { stableHash } from "@/features/security-scanner/fingerprint";

/**
 * Normalize repository-relative paths for cross-environment correlation.
 * Never use absolute local paths as identity.
 */
export function normalizeRepoRelativePath(filePath: string): string {
  const trimmed = filePath.trim().replace(/\\/g, "/");
  const withoutLeading = trimmed.replace(/^\/+/, "");
  const segments = withoutLeading.split("/").filter((segment) => segment && segment !== ".");
  const collapsed: string[] = [];
  for (const segment of segments) {
    if (segment === "..") {
      if (collapsed.length > 0) collapsed.pop();
      continue;
    }
    collapsed.push(segment);
  }
  return collapsed.join("/").toLowerCase();
}

/**
 * Deterministic finding correlation identity (line-independent).
 * Uses rule + normalized path + stable fingerprint material from scanner rules.
 */
export function buildFindingCorrelationKey(input: {
  ruleId: string;
  filePath: string;
  fingerprintMaterial?: string | null;
}): string {
  const path = normalizeRepoRelativePath(input.filePath);
  const material = (input.fingerprintMaterial ?? "").trim().toLowerCase();
  return stableHash(`${input.ruleId}\0${path}\0${material}`);
}

export function buildFindingCorrelationKeyFromParts(input: {
  ruleId: string;
  filePath: string;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
}): string {
  const storedKey =
    typeof input.metadata?.correlationKey === "string" ? input.metadata.correlationKey.trim() : "";
  if (storedKey) return storedKey;

  const material =
    typeof input.metadata?.correlationMaterial === "string"
      ? input.metadata.correlationMaterial
      : input.title ?? "";
  return buildFindingCorrelationKey({
    ruleId: input.ruleId,
    filePath: input.filePath,
    fingerprintMaterial: material,
  });
}
