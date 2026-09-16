import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalSeverity, SequrAIFinding } from "@/server/security-evidence/canonical-finding";
import type { EngineResult } from "./types";
import { crossEngineDeduplication } from "./deduplicate";

/**
 * Maps an existing `scan_findings` DB row (native 47-rule scanner) into the
 * canonical shape. Originally for cross-engine dedup only (below); exported
 * so the orchestrator's native-coverage loader (Phase 38) can reuse the SAME
 * mapping instead of a second, divergent one -- never persisted back over
 * the native row either way.
 */
export function mapScanFindingRowToSequrAIFinding(
  row: Record<string, unknown>,
  ctx: { scanId: string; projectId: string; organizationId: string }
): SequrAIFinding {
  const now = new Date().toISOString();
  const line = typeof row.start_line === "number" ? row.start_line : null;
  const filePath = (row.file_path as string | null) ?? null;
  return {
    id: row.id as string,
    fingerprint: (row.id as string) ?? "",
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    category: (row.category as string) ?? "security",
    severity: ((row.severity as string) ?? "medium").toLowerCase() as CanonicalSeverity,
    confidence: ((row.confidence as string) ?? "medium") as "high" | "medium" | "low",
    exploitability: { level: "UNKNOWN", confidence: 0.2, evidenceIds: [] },
    verificationStatus: "POTENTIAL",
    sources: ["native_scanner"],
    evidence: [
      {
        id: `${row.id}:native`,
        kind: "SOURCE_CODE",
        label: (row.title as string) ?? "",
        detail: JSON.stringify({ location: { path: filePath, line } }),
        redacted: false,
        capturedAt: now,
      },
    ],
    affectedFiles: filePath ? [filePath] : [],
    affectedEndpoints: [],
    affectedAssets: [],
    remediation: (row.recommendation as string | null) ?? null,
    references: [],
    cwe: Array.isArray((row.metadata as Record<string, unknown> | null)?.cwe)
      ? ((row.metadata as Record<string, unknown>).cwe as string[])
      : [],
    owasp: [],
    mitre: [],
    scanId: ctx.scanId,
    projectId: ctx.projectId,
    organizationId: ctx.organizationId,
    createdAt: now,
    updatedAt: now,
  };
}

export type PersistEngineResultsOutput = {
  findingsPersisted: number;
  executionsPersisted: number;
  correlationsPersisted: number;
};

/**
 * Phase 35: persists every engine's raw EngineResult (section 4) plus its
 * findings, then runs cross-engine deduplication against the native
 * scanner's already-persisted scan_findings for the same scan (fetched
 * read-only, never rewritten) and persists any resulting groups into the
 * SAME finding_correlations table Phase 34 introduced -- no second
 * correlation table.
 */
export async function persistEngineResults(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    results: EngineResult[];
  }
): Promise<PersistEngineResultsOutput> {
  const executionRows = input.results.map((r) => ({
    organization_id: input.organizationId,
    project_id: input.projectId,
    scan_id: input.scanId,
    engine: r.engine,
    engine_version: r.engineVersion,
    execution_id: r.executionId,
    status: r.status,
    started_at: r.startedAt,
    completed_at: r.completedAt,
    duration_ms: r.durationMs,
    capabilities_attempted: r.capabilitiesAttempted,
    capabilities_completed: r.capabilitiesCompleted,
    metrics: r.metrics,
    errors: r.errors,
  }));

  let executionsPersisted = 0;
  if (executionRows.length > 0) {
    const { error, count } = await admin.from("engine_executions").insert(executionRows, { count: "exact" });
    if (error) throw new Error(`Could not persist engine executions: ${error.message}`);
    executionsPersisted = count ?? executionRows.length;
  }

  const allFindings = input.results.flatMap((r) => r.findings);

  const findingRows = input.results.flatMap((result) =>
    result.findings.map((f) => ({
      organization_id: input.organizationId,
      project_id: input.projectId,
      scan_id: input.scanId,
      engine: result.engine,
      engine_version: result.engineVersion,
      execution_id: result.executionId,
      finding_id: f.id,
      fingerprint: f.fingerprint,
      title: f.title,
      description: f.description,
      category: f.category,
      severity: f.severity,
      confidence: f.confidence,
      verification_status: f.verificationStatus,
      exploitability: f.exploitability,
      sources: f.sources,
      evidence: f.evidence,
      affected_files: f.affectedFiles,
      affected_assets: f.affectedAssets,
      remediation: f.remediation,
      cwe: f.cwe,
      owasp: f.owasp,
    }))
  );

  let findingsPersisted = 0;
  if (findingRows.length > 0) {
    const { error, count } = await admin.from("external_engine_findings").insert(findingRows, { count: "exact" });
    if (error) throw new Error(`Could not persist external engine findings: ${error.message}`);
    findingsPersisted = count ?? findingRows.length;
  }

  // Cross-engine dedup against the native scanner's own findings for this
  // scan -- read-only fetch, native row never modified.
  const { data: nativeRows } = await admin
    .from("scan_findings")
    .select("id, title, description, severity, category, file_path, start_line, recommendation, confidence, metadata")
    .eq("scan_id", input.scanId)
    .eq("organization_id", input.organizationId);

  const nativeFindings = (nativeRows ?? []).map((row) =>
    mapScanFindingRowToSequrAIFinding(row as Record<string, unknown>, {
      scanId: input.scanId,
      projectId: input.projectId,
      organizationId: input.organizationId,
    })
  );

  const dedupGroups = crossEngineDeduplication([...nativeFindings, ...allFindings]);

  let correlationsPersisted = 0;
  if (dedupGroups.length > 0) {
    const correlationRows = dedupGroups.map((g) => ({
      organization_id: input.organizationId,
      project_id: input.projectId,
      scan_id: input.scanId,
      intelligence_report_id: `phase35-dedup:${input.scanId}`,
      kind: g.kind,
      confidence: g.confidence,
      rationale: g.rationale,
      finding_ids: g.findingIds,
      findings_snapshot: g.findingIds.map((id) => {
        const f = [...nativeFindings, ...allFindings].find((x) => x.id === id);
        return f ? { id: f.id, title: f.title, severity: f.severity, confidence: f.confidence, sources: f.sources } : { id };
      }),
    }));
    const { error, count } = await admin.from("finding_correlations").insert(correlationRows, { count: "exact" });
    if (error) throw new Error(`Could not persist cross-engine correlations: ${error.message}`);
    correlationsPersisted = count ?? correlationRows.length;
  }

  return { findingsPersisted, executionsPersisted, correlationsPersisted };
}
