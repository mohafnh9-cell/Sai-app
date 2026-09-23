import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductionVerdictByScan } from "@/server/production-verdict/service";
import { hasIncompleteExternalEngineCoverage } from "@/server/security-orchestrator/verdict-integration";
import { hasIncompleteNativeRuleCoverage } from "@/server/security-scanner/native-coverage";
import {
  matchKeysForExternalFinding,
  matchKeysForNativeFinding,
  type ExternalFindingRow,
  type NativeFindingRow,
  type TargetFinding,
} from "./finding-identity";
import type { ScanFacts, VerificationEvidence } from "./verification-rules";

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

type Row = Record<string, unknown>;

/** Reads every row (PostgREST truncates at 1000): a truncated rescan would fake an "absence". */
async function loadAllRows(
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error || !data) return null;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
  // More pages than we are willing to read: treat as unavailable, never as complete.
  return null;
}

function scanFacts(row: Row | null | undefined): ScanFacts | null {
  if (!row) return null;
  return {
    id: row.id as string,
    status: (row.status as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
    commitSha: (row.commit_sha as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    repositoryId: (row.repository_id as string | null) ?? null,
    organizationId: (row.organization_id as string | null) ?? null,
  };
}

const SCAN_COLUMNS =
  "id, status, created_at, commit_sha, branch, project_id, repository_id, organization_id, metrics, omissions";

function isStoredTarget(value: unknown): value is TargetFinding {
  const target = value as TargetFinding | null;
  return (
    !!target &&
    typeof target.findingId === "string" &&
    (target.source === "native" || target.source === "external") &&
    Array.isArray(target.matchKeys) &&
    target.matchKeys.length > 0 &&
    target.matchKeys.every((key) => typeof key === "string")
  );
}

async function confirmStoredTargets(
  admin: SupabaseClient,
  stored: readonly TargetFinding[],
  input: { organizationId: string; projectId: string; baselineScanId: string }
): Promise<boolean> {
  const nativeIds = stored.filter((t) => t.source === "native").map((t) => t.findingId);
  const externalIds = stored.filter((t) => t.source === "external").map((t) => t.findingId);

  const actualKeys = new Map<string, Set<string>>();
  if (nativeIds.length > 0) {
    const { data, error } = await admin
      .from("scan_findings")
      .select("id, fingerprint, rule_id, file_path, title, metadata")
      .eq("scan_id", input.baselineScanId)
      .eq("project_id", input.projectId)
      .in("id", nativeIds);
    if (error) return false;
    for (const row of (data ?? []) as NativeFindingRow[]) {
      if (row.id) actualKeys.set(row.id, new Set(matchKeysForNativeFinding(row)));
    }
  }
  if (externalIds.length > 0) {
    const { data, error } = await admin
      .from("external_engine_findings")
      .select("finding_id, fingerprint")
      .eq("scan_id", input.baselineScanId)
      .eq("organization_id", input.organizationId)
      .in("finding_id", externalIds);
    if (error) return false;
    for (const row of (data ?? []) as ExternalFindingRow[]) {
      if (row.finding_id) actualKeys.set(row.finding_id, new Set(matchKeysForExternalFinding(row)));
    }
  }

  return stored.every((target) => {
    const actual = actualKeys.get(target.findingId);
    return !!actual && target.matchKeys.some((key) => actual.has(key));
  });
}

/**
 * Resolves the exact finding(s) a fix recommendation targets, from the
 * BASELINE scan. `recommendationId` is a verdict priority id (whose
 * findingIds are the targets) or a finding id itself.
 */
export async function resolveTargetFindings(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    baselineScanId: string;
    recommendationId: string;
    storedTargets?: unknown;
  }
): Promise<{ targets: TargetFinding[]; fullyResolved: boolean }> {
  const stored = Array.isArray(input.storedTargets) ? input.storedTargets.filter(isStoredTarget) : [];
  if (stored.length > 0 && stored.length === (input.storedTargets as unknown[]).length) {
    // A recorded identity is only trusted if it is the identity of a real
    // baseline finding. A fingerprint that matches nothing in the baseline is
    // trivially "absent" from every rescan and would verify anything.
    const confirmed = await confirmStoredTargets(admin, stored, input);
    return confirmed
      ? { targets: stored, fullyResolved: true }
      : { targets: [], fullyResolved: false };
  }

  const verdict = await getProductionVerdictByScan(
    admin,
    input.organizationId,
    input.baselineScanId
  );
  const priority = verdict?.topPriorities.find((p) => p.id === input.recommendationId);
  const wantedIds = priority ? [...priority.findingIds] : [input.recommendationId];
  if (wantedIds.length === 0) return { targets: [], fullyResolved: false };

  const targets: TargetFinding[] = [];
  const found = new Set<string>();

  const { data: nativeRows } = await admin
    .from("scan_findings")
    .select("id, fingerprint, rule_id, file_path, title, metadata")
    .eq("scan_id", input.baselineScanId)
    .eq("project_id", input.projectId)
    .in("id", wantedIds);
  for (const row of (nativeRows ?? []) as NativeFindingRow[]) {
    const matchKeys = matchKeysForNativeFinding(row);
    if (!row.id || matchKeys.length === 0) continue;
    targets.push({ findingId: row.id, source: "native", matchKeys });
    found.add(row.id);
  }

  const missing = wantedIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    const { data: externalRows } = await admin
      .from("external_engine_findings")
      .select("finding_id, fingerprint")
      .eq("scan_id", input.baselineScanId)
      .eq("organization_id", input.organizationId)
      .in("finding_id", missing);
    for (const row of (externalRows ?? []) as ExternalFindingRow[]) {
      const matchKeys = matchKeysForExternalFinding(row);
      if (!row.finding_id || matchKeys.length === 0) continue;
      targets.push({ findingId: row.finding_id, source: "external", matchKeys });
      found.add(row.finding_id);
    }
  }

  return { targets, fullyResolved: wantedIds.every((id) => found.has(id)) };
}

/** Gathers every fact the pure verification rules need. Anything unreadable stays unknown, never "clean". */
export async function loadVerificationEvidence(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    baselineScanId: string | null;
    verificationScanId: string | null;
    recommendationId: string;
    storedTargets?: unknown;
  }
): Promise<VerificationEvidence> {
  const [baselineRes, rescanRes] = await Promise.all([
    input.baselineScanId
      ? admin.from("scans").select(SCAN_COLUMNS).eq("id", input.baselineScanId).maybeSingle()
      : Promise.resolve({ data: null }),
    input.verificationScanId
      ? admin.from("scans").select(SCAN_COLUMNS).eq("id", input.verificationScanId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const baselineRow = (baselineRes.data ?? null) as Row | null;
  const rescanRow = (rescanRes.data ?? null) as Row | null;

  const baselineScan = scanFacts(baselineRow);
  const verificationScan = scanFacts(rescanRow);

  const targetResolution = input.baselineScanId
    ? await resolveTargetFindings(admin, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        baselineScanId: input.baselineScanId,
        recommendationId: input.recommendationId,
        storedTargets: input.storedTargets,
      })
    : { targets: [] as TargetFinding[], fullyResolved: false };

  let verdict = null;
  let externalEngineIncomplete = false;
  let nativeRuleCoverageIncomplete = false;
  let rescanKeys: Set<string> | null = null;

  if (verificationScan && rescanRow) {
    verdict = await getProductionVerdictByScan(admin, input.organizationId, verificationScan.id);
    externalEngineIncomplete = await hasIncompleteExternalEngineCoverage(admin, {
      scanId: verificationScan.id,
      organizationId: input.organizationId,
    }).catch(() => true);
    nativeRuleCoverageIncomplete = hasIncompleteNativeRuleCoverage({
      metrics: rescanRow.metrics,
      omissions: rescanRow.omissions,
    });

    const nativeRows = await loadAllRows((from, to) =>
      admin
        .from("scan_findings")
        .select("id, fingerprint, rule_id, file_path, title, metadata")
        .eq("scan_id", verificationScan.id)
        .range(from, to)
    );
    const externalRows = await loadAllRows((from, to) =>
      admin
        .from("external_engine_findings")
        .select("finding_id, fingerprint")
        .eq("scan_id", verificationScan.id)
        .eq("organization_id", input.organizationId)
        .range(from, to)
    );
    if (nativeRows && externalRows) {
      rescanKeys = new Set<string>();
      for (const row of nativeRows) {
        for (const key of matchKeysForNativeFinding(row as NativeFindingRow)) rescanKeys.add(key);
      }
      for (const row of externalRows) {
        for (const key of matchKeysForExternalFinding(row as ExternalFindingRow)) rescanKeys.add(key);
      }
    }
  }

  return {
    projectId: input.projectId,
    organizationId: input.organizationId,
    baselineScan,
    verificationScan,
    verdict,
    externalEngineIncomplete,
    nativeRuleCoverageIncomplete,
    targets: targetResolution.targets,
    targetsFullyResolved: targetResolution.fullyResolved,
    rescanKeys,
  };
}
