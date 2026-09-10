import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackFinding } from "../types/attack-models";
import type { AttackChain, FindingCorrelationGroup, SecurityIntelligenceReport } from "./models";

export type AttackChainStatus = "POTENTIAL" | "PARTIALLY_VALIDATED" | "CONFIRMED";

/**
 * Phase 34, section 6/7: derive chain status from the CONSTITUENT FINDINGS'
 * OWN evidence -- never from chain length alone. A chain of five weakly-
 * evidenced findings stays POTENTIAL; two strongly-evidenced findings can
 * reach CONFIRMED.
 *
 * "Strongly evidenced" for an AttackFinding = high confidence (>=0.85) AND
 * at least one attached evidence id (evidenceIds.length > 0) -- confidence
 * alone is not enough, since a highly-confident static suspicion is still
 * not proof; it must be backed by a captured evidence artifact from the
 * dynamic-testing/attack-simulation pipeline that produced these findings.
 */
export function deriveAttackChainStatus(
  chain: AttackChain,
  findingsById: ReadonlyMap<string, AttackFinding>
): AttackChainStatus {
  const findings = chain.findingIds.map((id) => findingsById.get(id)).filter((f): f is AttackFinding => Boolean(f));

  const stronglyEvidenced = findings.filter((f) => f.confidence >= 0.85 && f.evidenceIds.length > 0);
  const anyEvidenced = findings.filter((f) => f.evidenceIds.length > 0);

  if (stronglyEvidenced.length >= 2) return "CONFIRMED";
  if (anyEvidenced.length >= 1) return "PARTIALLY_VALIDATED";
  return "POTENTIAL";
}

function statusRationale(status: AttackChainStatus, findingCount: number): string {
  switch (status) {
    case "CONFIRMED":
      return `${findingCount} correlated findings, at least two independently backed by captured runtime evidence.`;
    case "PARTIALLY_VALIDATED":
      return `${findingCount} correlated findings, at least one backed by captured evidence; not yet independently confirmed.`;
    default:
      return `${findingCount} correlated findings with no captured runtime evidence yet -- correlation only.`;
  }
}

function snapshotFindings(ids: string[], findingsById: ReadonlyMap<string, AttackFinding>) {
  return ids
    .map((id) => findingsById.get(id))
    .filter((f): f is AttackFinding => Boolean(f))
    .map((f) => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      confidence: f.confidence,
      domain: f.domain,
      evidenceCount: f.evidenceIds.length,
    }));
}

export type PersistSecurityIntelligenceResult = {
  correlationsPersisted: number;
  chainsPersisted: number;
};

/**
 * Phase 34, section 9: the existing correlation-engine / attack-chain-builder
 * output already computed for `report` is persisted here as first-class,
 * queryable rows instead of being collapsed to a count + string summaries.
 * Detection logic itself (correlation-engine.ts, attack-chain-builder.ts) is
 * untouched -- this is purely a persistence step, called after the report is
 * already fully computed.
 *
 * Non-fatal by design: a persistence failure here must never fail the scan
 * that already completed successfully. Callers should treat rejections as
 * best-effort and log, not propagate.
 */
export async function persistSecurityIntelligence(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    report: SecurityIntelligenceReport;
  }
): Promise<PersistSecurityIntelligenceResult> {
  const findingsById = new Map<string, AttackFinding>(input.report.deduplicatedFindings.map((f) => [f.id, f]));

  const correlationRows = input.report.correlations.map((group: FindingCorrelationGroup) => ({
    organization_id: input.organizationId,
    project_id: input.projectId,
    scan_id: input.scanId,
    intelligence_report_id: input.report.reportId,
    kind: group.kind,
    confidence: group.confidence,
    rationale: group.rationale,
    finding_ids: group.findingIds,
    findings_snapshot: snapshotFindings(group.findingIds, findingsById),
  }));

  const chainRows = input.report.attackChains.map((chain: AttackChain) => {
    const status = deriveAttackChainStatus(chain, findingsById);
    return {
      organization_id: input.organizationId,
      project_id: input.projectId,
      scan_id: input.scanId,
      intelligence_report_id: input.report.reportId,
      title: chain.summary.slice(0, 200),
      summary: chain.summary,
      severity: chain.severity,
      score: chain.score,
      status,
      status_rationale: statusRationale(status, chain.findingIds.length),
      finding_ids: chain.findingIds,
      findings_snapshot: snapshotFindings(chain.findingIds, findingsById),
      steps: chain.steps,
      evidence_ids: chain.findingIds.flatMap((id) => findingsById.get(id)?.evidenceIds ?? []),
      affected_assets: [],
    };
  });

  let correlationsPersisted = 0;
  let chainsPersisted = 0;

  if (correlationRows.length > 0) {
    const { error, count } = await admin
      .from("finding_correlations")
      .insert(correlationRows, { count: "exact" });
    if (error) {
      throw new Error(`Could not persist finding correlations: ${error.message}`);
    }
    correlationsPersisted = count ?? correlationRows.length;
  }

  if (chainRows.length > 0) {
    const { error, count } = await admin.from("attack_chains").insert(chainRows, { count: "exact" });
    if (error) {
      throw new Error(`Could not persist attack chains: ${error.message}`);
    }
    chainsPersisted = count ?? chainRows.length;
  }

  return { correlationsPersisted, chainsPersisted };
}
