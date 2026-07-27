import type { ThreatModel, ThreatModelValidationIssue, ThreatModelValidationResult } from "./threat-model.types";
import { sortByLogicalId } from "./deterministic-id";

export function validateThreatModel(model: ThreatModel): ThreatModelValidationResult {
  const issues: ThreatModelValidationIssue[] = [];
  const assetIds = new Set(model.objectives.flatMap((o) => o.protectedAssetIds));
  const nodeIds = new Set(model.nodes.map((n) => n.logicalId));
  const preconditionIds = new Set(model.conditions.map((c) => c.logicalId));
  const objectiveIds = new Set(model.objectives.map((o) => o.logicalId));

  const isKnownRef = (ref: string) =>
    nodeIds.has(ref as import("../core/contracts/identifiers").CoreUniqueId) ||
    assetIds.has(ref as import("../core/contracts/identifiers").CoreUniqueId) ||
    preconditionIds.has(ref as import("../core/contracts/identifiers").CoreUniqueId) ||
    objectiveIds.has(ref as import("../core/contracts/identifiers").CoreUniqueId);

  for (const objective of model.objectives) {
    if (!objective.protectedAssetIds.length) {
      issues.push({
        code: "objective_missing_asset",
        message: `Objective ${objective.logicalId} must reference a protected asset.`,
        path: objective.logicalId,
      });
    }
  }

  for (const chain of model.chains) {
    if (!chain.preconditionIds.length) {
      issues.push({
        code: "chain_missing_preconditions",
        message: `Chain ${chain.logicalId} must include attack preconditions.`,
        path: chain.logicalId,
      });
    }
    for (const step of chain.steps) {
      for (const ref of step.nodeRefs) {
        if (!isKnownRef(ref)) {
          issues.push({
            code: "chain_invalid_node_ref",
            message: `Chain step references unknown node ${ref}.`,
            path: chain.logicalId,
          });
        }
      }
    }
    if (chain.crossTeam && chain.teams.length < 2) {
      issues.push({
        code: "cross_team_evidence_missing",
        message: `Cross-team chain ${chain.logicalId} requires RT9 and RT10 evidence.`,
        path: chain.logicalId,
      });
    }
  }

  issues.sort((a, b) => `${a.code}:${a.path ?? ""}`.localeCompare(`${b.code}:${b.path ?? ""}`));

  return { valid: issues.length === 0, issues };
}

export function parseThreatModelJson(raw: unknown): ThreatModel | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as ThreatModel;
  if (m.version !== "1.0.0" || m.contractId !== "sequrai.threat-model") return null;
  if (!m.context?.scope?.scanId) return null;
  return m;
}

export function serializeThreatModel(model: ThreatModel): string {
  const normalized: ThreatModel = {
    ...model,
    actors: sortByLogicalId(model.actors),
    objectives: sortByLogicalId(model.objectives),
    surfaces: sortByLogicalId(model.surfaces),
    vectors: sortByLogicalId(model.vectors),
    paths: sortByLogicalId(model.paths),
    chains: sortByLogicalId(model.chains).map((c) => ({
      ...c,
      steps: [...c.steps].sort((a, b) => a.order - b.order),
    })),
    nodes: sortByLogicalId(model.nodes),
    relationships: sortByLogicalId(model.relationships),
    scenarios: sortByLogicalId(model.scenarios),
  };
  return JSON.stringify(normalized);
}
