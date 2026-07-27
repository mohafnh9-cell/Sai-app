import { createHash } from "node:crypto";

/** Deterministic identifier from stable semantic key (UUIDs excluded from equality). */
export function stableAiId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

export function stableNodeKey(kind: string, label: string, scope?: string): string {
  return `${kind}:${label}${scope ? `:${scope}` : ""}`;
}
