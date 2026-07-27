/** Shared finding / risk severity — not CVSS. */
export type CoreFindingSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "informational";

export const CORE_FINDING_SEVERITIES: readonly CoreFindingSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "informational",
] as const;
