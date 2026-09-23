import { buildFindingCorrelationKeyFromParts } from "@/lib/correlation/finding-identity";

/**
 * Finding identity for fix verification. This reuses the identities the
 * platform already persists -- it does not introduce a second system:
 *
 *  - native findings: `scan_findings.fingerprint` (exact: rule + path + line +
 *    rule material) and the existing line-independent correlation key
 *    (rule + normalized path + material). A fix or an unrelated edit that only
 *    moves a finding to another line changes the fingerprint but not the
 *    correlation key, so BOTH are matched: a finding that merely moved is
 *    still present.
 *  - external-engine findings: `external_engine_findings.fingerprint` and the
 *    engine's own deterministic `finding_id`.
 *
 * Titles are never identity.
 */

export type NativeFindingRow = {
  id?: string | null;
  fingerprint?: string | null;
  rule_id?: string | null;
  file_path?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ExternalFindingRow = {
  finding_id?: string | null;
  fingerprint?: string | null;
};

export type TargetFinding = {
  /** scan_findings.id, or external finding_id, of the baseline finding. */
  findingId: string;
  source: "native" | "external";
  /** Any one of these keys appearing in a rescan means the finding is still present. */
  matchKeys: string[];
};

export function matchKeysForNativeFinding(row: NativeFindingRow): string[] {
  const keys: string[] = [];
  if (row.fingerprint) keys.push(`fp:${row.fingerprint}`);
  if (row.rule_id && row.file_path) {
    keys.push(
      `ck:${buildFindingCorrelationKeyFromParts({
        ruleId: row.rule_id,
        filePath: row.file_path,
        title: row.title ?? null,
        metadata: row.metadata ?? null,
      })}`
    );
  }
  return keys;
}

export function matchKeysForExternalFinding(row: ExternalFindingRow): string[] {
  const keys: string[] = [];
  if (row.fingerprint) keys.push(`fp:${row.fingerprint}`);
  if (row.finding_id) keys.push(`fid:${row.finding_id}`);
  return keys;
}

/** True when any target finding is still present in the rescan's key set. */
export function targetsStillPresent(
  targets: readonly TargetFinding[],
  rescanKeys: ReadonlySet<string>
): TargetFinding[] {
  return targets.filter((target) => target.matchKeys.some((key) => rescanKeys.has(key)));
}
