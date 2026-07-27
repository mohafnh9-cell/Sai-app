import { createHash } from "node:crypto";
import type { CoreUniqueId } from "../core/contracts/identifiers";
import type { ThreatScope } from "./threat-model.types";

export function threatLogicalId(parts: string[]): CoreUniqueId {
  const normalized = parts.map((p) => p.trim().toLowerCase()).sort((a, b) => a.localeCompare(b));
  const digest = createHash("sha256").update(normalized.join("|")).digest("hex").slice(0, 32);
  return `tm:${digest}` as CoreUniqueId;
}

export function threatChainFingerprint(input: {
  scope: ThreatScope;
  pathLogicalId: string;
  stepKinds: string[];
  assetIds: string[];
  objectiveKind: string;
}): string {
  const payload = [
    input.scope.scanId,
    input.scope.projectId,
    input.pathLogicalId,
    ...input.stepKinds.sort(),
    ...input.assetIds.sort(),
    input.objectiveKind,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function sortByLogicalId<T extends { logicalId: CoreUniqueId }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.logicalId.localeCompare(b.logicalId));
}

export function modelFingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.sort().join("|")).digest("hex");
}
