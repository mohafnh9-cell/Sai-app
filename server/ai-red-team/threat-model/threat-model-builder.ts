import type { CoreUniqueId } from "../core/contracts/identifiers";
import type {
  ThreatModel,
  ThreatModelBuildInput,
  ThreatModelSummary,
  ThreatActor,
  ThreatActorKind,
  ThreatSurface,
  ThreatVector,
  ThreatObjective,
  ThreatObjectiveKind,
  ThreatPath,
  ThreatChain,
  ThreatChainStep,
  ThreatNode,
  ThreatRelationship,
  ThreatScenario,
  ThreatCondition,
  SecurityObjective,
  BusinessImpact,
  ThreatCapability,
  ThreatModelContext,
} from "./threat-model.types";
import { THREAT_MODEL_CONTRACT_ID, THREAT_MODEL_VERSION } from "./version";
import {
  collectProtectedAssets,
  discoverySurfaceKinds,
  evidenceFromSources,
  hasCrossTeamEvidence,
  hasMinimumEvidence,
  mapDiscoveryToSourceRefs,
} from "./input-mapping";
import { threatChainFingerprint, threatLogicalId, modelFingerprint, sortByLogicalId } from "./deterministic-id";
import { classifyFeasibility, classifyPriority, estimateAttackCost } from "./scoring";
import { validateThreatModel } from "./validation";

const ACTOR_CATALOG: Array<{
  kind: ThreatActorKind;
  label: string;
  privileges: string[];
  surfaces: import("./threat-model.types").ThreatSurfaceKind[];
}> = [
  { kind: "anonymous_user", label: "Anonymous User", privileges: ["public"], surfaces: ["endpoint", "browser_flow"] },
  { kind: "authenticated_user", label: "Authenticated User", privileges: ["authenticated"], surfaces: ["api", "session"] },
  { kind: "workspace_member", label: "Workspace Member", privileges: ["member"], surfaces: ["api", "business_workflow"] },
  { kind: "compromised_agent", label: "Compromised Agent", privileges: ["agent_token"], surfaces: ["agent", "tool"] },
  { kind: "compromised_mcp_server", label: "Compromised MCP Server", privileges: ["mcp_trust"], surfaces: ["mcp_server", "mcp_client"] },
  { kind: "malicious_insider", label: "Malicious Insider", privileges: ["internal"], surfaces: ["business_workflow", "configuration"] },
  { kind: "external_attacker", label: "External Attacker", privileges: ["none"], surfaces: ["api", "webhook", "external_integration"] },
  { kind: "knowledge_base_editor", label: "Knowledge Base Editor", privileges: ["kb_write"], surfaces: ["knowledge_base", "vector_store"] },
];

const OBJECTIVE_BY_SURFACE: Partial<
  Record<import("./threat-model.types").ThreatSurfaceKind, ThreatObjectiveKind>
> = {
  business_workflow: "business_logic_abuse",
  prompt: "prompt_extraction",
  tool: "tool_abuse",
  agent: "tool_abuse",
  mcp_server: "tool_abuse",
  knowledge_base: "rag_poisoning",
  vector_store: "rag_poisoning",
  memory: "memory_poisoning",
  webhook: "integrity_violation",
  api: "privilege_escalation",
  session: "account_takeover",
  configuration: "configuration_manipulation",
};

function assetLogicalId(scope: ThreatModelBuildInput["scope"], assetId: string): CoreUniqueId {
  return threatLogicalId(["asset", scope.scanId, assetId]);
}

function boundaryLogicalId(scope: ThreatModelBuildInput["scope"], boundaryId: string): CoreUniqueId {
  return threatLogicalId(["boundary", scope.scanId, boundaryId]);
}

function buildActors(input: ThreatModelBuildInput, surfaces: ThreatSurface[]): ThreatActor[] {
  const surfaceKinds = new Set(surfaces.map((s) => s.kind));
  const refs = mapDiscoveryToSourceRefs(input);
  const actors: ThreatActor[] = [];
  for (const def of ACTOR_CATALOG) {
    if (!def.surfaces.some((sk) => surfaceKinds.has(sk))) continue;
    const boundaryIds = (input.rt10?.boundaryIds ?? []).map((b) => boundaryLogicalId(input.scope, b));
    actors.push({
      logicalId: threatLogicalId(["actor", input.scope.scanId, def.kind]),
      kind: def.kind,
      label: def.label,
      startingPrivileges: def.privileges,
      requiredAccess: def.surfaces,
      supportedCapabilities: def.privileges,
      controlledComponents: [],
      reachableBoundaryIds: boundaryIds,
      constraints: [],
      evidence: [evidenceFromSources(input.scope, refs, `Actor ${def.label} reachable from validated surfaces`, "medium")],
      confidence: "medium",
    });
  }
  return sortByLogicalId(actors);
}

function buildSurfaces(input: ThreatModelBuildInput): ThreatSurface[] {
  const discovered = discoverySurfaceKinds(input);
  const surfaces: ThreatSurface[] = discovered.map((d) => ({
    logicalId: threatLogicalId(["surface", input.scope.scanId, d.kind, d.ref.refId]),
    kind: d.kind,
    label: d.label,
    sourceRefs: [d.ref],
    boundaryIds: (input.rt10?.boundaryIds ?? []).map((b) => boundaryLogicalId(input.scope, b)),
    evidence: [evidenceFromSources(input.scope, [d.ref], `Surface derived from discovery ${d.ref.refId}`, d.confidence)],
    confidence: d.confidence,
  }));
  return sortByLogicalId(surfaces);
}

function buildSecurityObjectives(
  input: ThreatModelBuildInput,
  assetIds: CoreUniqueId[]
): SecurityObjective[] {
  const kinds: Array<{ kind: SecurityObjective["kind"]; label: string }> = [
    { kind: "workflow_integrity", label: "Workflow Integrity" },
    { kind: "tool_authorization", label: "Tool Authorization" },
    { kind: "tenant_isolation", label: "Tenant Isolation" },
    { kind: "retrieval_integrity", label: "Retrieval Integrity" },
    { kind: "financial_integrity", label: "Financial Integrity" },
  ];
  return kinds.map((k) => ({
    logicalId: threatLogicalId(["secobj", input.scope.scanId, k.kind]),
    kind: k.kind,
    label: k.label,
    protectedAssetIds: assetIds.slice(0, Math.min(3, assetIds.length)),
  }));
}

function buildConditions(input: ThreatModelBuildInput): ThreatCondition[] {
  const conditions: ThreatCondition[] = [];
  for (const p of input.rt9?.preconditions ?? []) {
    const blocking = (p.blocking ?? []).length > 0;
    conditions.push({
      logicalId: threatLogicalId(["precond", input.scope.scanId, "rt9", p.id]),
      label: p.label,
      satisfied: !blocking,
      blocking,
      sourceRefs: [{ kind: "rt9_precondition", refId: p.id, label: p.label }],
    });
  }
  for (const p of input.rt10?.preconditions ?? []) {
    const unsupported = (p.unsupported ?? []).length > 0;
    conditions.push({
      logicalId: threatLogicalId(["precond", input.scope.scanId, "rt10", p.id]),
      label: p.label,
      satisfied: !unsupported,
      blocking: unsupported,
      sourceRefs: [{ kind: "rt10_precondition", refId: p.id, label: p.label }],
    });
  }
  return sortByLogicalId(conditions);
}

function buildObjectives(
  input: ThreatModelBuildInput,
  surfaces: ThreatSurface[],
  assetIds: CoreUniqueId[],
  securityObjectiveIds: CoreUniqueId[]
): ThreatObjective[] {
  const refs = mapDiscoveryToSourceRefs(input);
  const objectives: ThreatObjective[] = [];
  const seen = new Set<string>();
  for (const surface of surfaces) {
    const kind = OBJECTIVE_BY_SURFACE[surface.kind];
    if (!kind || seen.has(kind)) continue;
    if (!assetIds.length) continue;
    seen.add(kind);
    objectives.push({
      logicalId: threatLogicalId(["objective", input.scope.scanId, kind]),
      kind,
      label: kind.replace(/_/g, " "),
      protectedAssetIds: [assetIds[0]!],
      securityObjectiveIds: securityObjectiveIds.slice(0, 1),
      evidence: [evidenceFromSources(input.scope, refs, `Objective tied to surface ${surface.label}`, surface.confidence)],
    });
  }
  return sortByLogicalId(objectives);
}

function buildPathsAndChains(input: ThreatModelBuildInput, ctx: {
  actors: ThreatActor[];
  surfaces: ThreatSurface[];
  objectives: ThreatObjective[];
  conditions: ThreatCondition[];
  assetIds: CoreUniqueId[];
}): { paths: ThreatPath[]; chains: ThreatChain[]; nodes: ThreatNode[]; relationships: ThreatRelationship[] } {
  const paths: ThreatPath[] = [];
  const chains: ThreatChain[] = [];
  const nodes: ThreatNode[] = [];
  const relationships: ThreatRelationship[] = [];
  const crossTeam = hasCrossTeamEvidence(input);
  const refs = mapDiscoveryToSourceRefs(input);

  for (const actor of ctx.actors) {
    for (const surface of ctx.surfaces) {
      if (!actor.requiredAccess.includes(surface.kind)) continue;
      const objective = ctx.objectives.find((o) => OBJECTIVE_BY_SURFACE[surface.kind] === o.kind);
      if (!objective || !ctx.assetIds[0]) continue;

      const vectorId = threatLogicalId(["vector", input.scope.scanId, actor.kind, surface.logicalId]);
      const pathId = threatLogicalId(["path", input.scope.scanId, actor.kind, surface.kind, objective.kind]);
      const preconditionIds = ctx.conditions.map((c) => c.logicalId);
      const hasUnsupported = (input.rt10?.preconditions ?? []).some((p) => (p.unsupported ?? []).length > 0);

      const attackCost = estimateAttackCost({
        actorKind: actor.kind,
        crossTeam,
        stepCount: crossTeam ? 5 : 3,
        detectionSurfaces: ctx.surfaces.length,
      });
      const feasibility = classifyFeasibility({
        conditions: ctx.conditions,
        hasUnsupportedPreconditions: hasUnsupported,
        evidenceConfidence: surface.confidence,
        attackCost,
      });
      const priority = classifyPriority({
        feasibility,
        assetCriticality: surface.kind === "business_workflow" ? "critical" : "high",
        businessImpact: crossTeam ? "critical" : "high",
        confidence: surface.confidence,
        crossTeam,
      });

      paths.push({
        logicalId: pathId,
        actorId: actor.logicalId,
        surfaceId: surface.logicalId,
        vectorId,
        boundaryIds: surface.boundaryIds,
        preconditionIds,
        protectedAssetId: ctx.assetIds[0],
        objectiveId: objective.logicalId,
        stepOrder: [actor.logicalId, surface.logicalId, vectorId, objective.logicalId],
        evidence: [evidenceFromSources(input.scope, refs, "Path from actor through surface to objective", surface.confidence)],
        feasibility,
      });

      const actorNodeId = threatLogicalId(["node", "actor", actor.logicalId]);
      const surfaceNodeId = threatLogicalId(["node", "surface", surface.logicalId]);

      const steps: ThreatChainStep[] = [
        {
          logicalId: threatLogicalId(["step", pathId, "0", "entry"]),
          order: 0,
          kind: "entry_point",
          label: `Entry via ${surface.label}`,
          nodeRefs: [surfaceNodeId, actorNodeId],
          boundaryCrossingIds: [],
          expectedEvidence: ["discovery_surface"],
          detectionOpportunity: "Access logging on entry surface",
          cleanupModeled: null,
        },
        {
          logicalId: threatLogicalId(["step", pathId, "1", "precond"]),
          order: 1,
          kind: "precondition",
          label: "Attack preconditions evaluated",
          nodeRefs: preconditionIds,
          boundaryCrossingIds: [],
          expectedEvidence: ["precondition_model"],
          detectionOpportunity: null,
          cleanupModeled: null,
        },
        {
          logicalId: threatLogicalId(["step", pathId, "2", "objective"]),
          order: 2,
          kind: "objective",
          label: objective.label,
          nodeRefs: [objective.logicalId, ctx.assetIds[0]!],
          boundaryCrossingIds: surface.boundaryIds,
          expectedEvidence: ["runtime_simulation", "invariant_violation"],
          detectionOpportunity: "Anomaly detection on protected asset",
          cleanupModeled: "Attacker clears session artifacts only (modeled)",
        },
      ];

      if (crossTeam) {
        steps.splice(2, 0, {
          logicalId: threatLogicalId(["step", pathId, "x", "lateral"]),
          order: 2,
          kind: "lateral_movement",
          label: "Cross-team precondition bridge (RT9 workflow → RT10 tool)",
          nodeRefs: preconditionIds,
          boundaryCrossingIds: surface.boundaryIds,
          expectedEvidence: ["intelligence_correlation"],
          detectionOpportunity: "Correlate business audit with AI tool invocation",
          cleanupModeled: null,
        });
      }

      const fingerprint = threatChainFingerprint({
        scope: input.scope,
        pathLogicalId: pathId,
        stepKinds: steps.map((s) => s.kind),
        assetIds: ctx.assetIds.map(String),
        objectiveKind: objective.kind,
      });

      chains.push({
        logicalId: threatLogicalId(["chain", input.scope.scanId, fingerprint.slice(0, 16)]),
        fingerprint,
        pathId,
        steps,
        preconditionIds,
        protectedAssetIds: ctx.assetIds,
        objectiveId: objective.logicalId,
        attackCost,
        feasibility,
        priority,
        crossTeam,
        teams: crossTeam
          ? ["rt9", "rt10"]
          : surface.kind === "business_workflow"
            ? ["rt9"]
            : ["rt10"],
        evidence: [evidenceFromSources(input.scope, refs, "Chain hypothesis from validated path", surface.confidence)],
      });

      nodes.push(
        {
          logicalId: actorNodeId,
          kind: "actor",
          refId: actor.logicalId,
          label: actor.label,
          scope: input.scope,
          evidence: actor.evidence,
          confidence: actor.confidence,
        },
        {
          logicalId: surfaceNodeId,
          kind: "surface",
          refId: surface.logicalId,
          label: surface.label,
          scope: input.scope,
          evidence: surface.evidence,
          confidence: surface.confidence,
        }
      );
      relationships.push({
        logicalId: threatLogicalId(["rel", actor.logicalId, surface.logicalId]),
        kind: "leads_to",
        fromNodeId: actorNodeId,
        toNodeId: surfaceNodeId,
        evidence: surface.evidence,
      });
    }
  }

  return {
    paths: sortByLogicalId(paths),
    chains: sortByLogicalId(chains),
    nodes: sortByLogicalId(nodes),
    relationships: sortByLogicalId(relationships),
  };
}

function summarize(model: Omit<ThreatModel, "summary">): ThreatModelSummary {
  const feasibilityBreakdown: ThreatModelSummary["feasibilityBreakdown"] = {
    blocked: 0,
    unlikely: 0,
    conditional: 0,
    feasible: 0,
    highly_feasible: 0,
  };
  const priorityBreakdown: ThreatModelSummary["priorityBreakdown"] = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  };
  for (const c of model.chains) {
    feasibilityBreakdown[c.feasibility] += 1;
    priorityBreakdown[c.priority] += 1;
  }
  return {
    actorCount: model.actors.length,
    surfaceCount: model.surfaces.length,
    pathCount: model.paths.length,
    chainCount: model.chains.length,
    crossTeamChainCount: model.chains.filter((c) => c.crossTeam).length,
    blockedChainCount: model.chains.filter((c) => c.feasibility === "blocked").length,
    feasibilityBreakdown,
    priorityBreakdown,
  };
}

export type ThreatModelBuildResult = {
  model: ThreatModel | null;
  validation: ReturnType<typeof validateThreatModel>;
  rejectedReason: string | null;
};

export function buildThreatModel(input: ThreatModelBuildInput): ThreatModelBuildResult {
  if (!hasMinimumEvidence(input)) {
    return {
      model: null,
      validation: { valid: false, issues: [{ code: "insufficient_evidence", message: "Threat model requires discovery plus RT9/RT10/platform evidence." }] },
      rejectedReason: "insufficient_evidence",
    };
  }

  const artifactRefs = mapDiscoveryToSourceRefs(input);
  const context: ThreatModelContext = {
    scope: input.scope,
    discoveryReportId: input.discovery?.reportId ?? null,
    intelligenceReportId: input.intelligence?.reportId ?? null,
    platformMetadataVersion: input.platform?.version ?? null,
    inputArtifactRefs: artifactRefs,
  };

  const rawAssets = collectProtectedAssets(input);
  const assetIds = rawAssets.map((a) => assetLogicalId(input.scope, a.id));

  const surfaces = buildSurfaces(input);
  const actors = buildActors(input, surfaces);
  const securityObjectives = buildSecurityObjectives(input, assetIds);
  const secObjIds = securityObjectives.map((s) => s.logicalId);
  const objectives = buildObjectives(input, surfaces, assetIds, secObjIds);
  const conditions = buildConditions(input);

  const graph = buildPathsAndChains(input, {
    actors,
    surfaces,
    objectives,
    conditions,
    assetIds,
  });

  const vectors: ThreatVector[] = sortByLogicalId(
    graph.paths.map((p) => {
      const actor = actors.find((a) => a.logicalId === p.actorId)!;
      const surface = surfaces.find((s) => s.logicalId === p.surfaceId)!;
      return {
        logicalId: p.vectorId,
        label: `${actor.label} → ${surface.label}`,
        surfaceId: surface.logicalId,
        actorKind: actor.kind,
        evidence: p.evidence,
      };
    })
  );

  const capabilities: ThreatCapability[] = sortByLogicalId(
    actors.flatMap((a) =>
      a.supportedCapabilities.map((cap) => ({
        logicalId: threatLogicalId(["cap", input.scope.scanId, a.kind, cap]),
        label: cap,
        actorKinds: [a.kind],
        evidence: a.evidence,
      }))
    )
  );

  const businessImpacts: BusinessImpact[] = objectives.map((o) => ({
    logicalId: threatLogicalId(["impact", o.logicalId]),
    summary: `Impact to ${o.label}`,
    severityBand: o.kind.includes("financial") ? "critical" : "high",
    affectedAssetIds: o.protectedAssetIds,
    evidence: o.evidence,
  }));

  const scenarios: ThreatScenario[] = sortByLogicalId(
    objectives.map((o) => {
      const relatedPaths = graph.paths.filter((p) => p.objectiveId === o.logicalId);
      const relatedChains = graph.chains.filter((c) => c.objectiveId === o.logicalId);
      const actor = actors.find((a) => relatedPaths.some((p) => p.actorId === a.logicalId));
      return {
        logicalId: threatLogicalId(["scenario", input.scope.scanId, o.kind]),
        title: o.label,
        category: o.kind.includes("business") ? "business_abuse" : "ai_trust_violation",
        actorId: actor?.logicalId ?? actors[0]?.logicalId ?? o.logicalId,
        objectiveId: o.logicalId,
        pathIds: relatedPaths.map((p) => p.logicalId),
        chainIds: relatedChains.map((c) => c.logicalId),
        securityObjectiveIds: o.securityObjectiveIds,
        evidence: o.evidence,
      };
    })
  );

  const fingerprint = modelFingerprint([
    input.scope.scanId,
    ...actors.map((a) => a.logicalId),
    ...surfaces.map((s) => s.logicalId),
    ...graph.chains.map((c) => c.fingerprint),
  ]);

  const partial: Omit<ThreatModel, "summary"> = {
    version: THREAT_MODEL_VERSION,
    contractId: THREAT_MODEL_CONTRACT_ID,
    context,
    actors,
    capabilities,
    objectives,
    surfaces,
    vectors,
    securityObjectives,
    businessImpacts,
    conditions,
    constraints: [],
    nodes: graph.nodes,
    relationships: graph.relationships,
    paths: graph.paths,
    chains: graph.chains,
    scenarios,
    metadata: {
      generatedAt: new Date(0).toISOString(),
      generatorVersion: THREAT_MODEL_VERSION,
      fingerprint,
      tags: ["modeling_only", "rt11_foundation"],
    },
  };

  const model: ThreatModel = { ...partial, summary: summarize(partial) };
  const validation = validateThreatModel(model);
  return { model, validation, rejectedReason: validation.valid ? null : "validation_failed" };
}
