import type {
  ThreatModelBuildInput,
  ThreatSourceReference,
  ThreatEvidence,
  ThreatScope,
  ThreatSurfaceKind,
} from "./threat-model.types";
import type { CoreFindingConfidence } from "../core/confidence/confidence.types";
import { threatLogicalId } from "./deterministic-id";

const DISCOVERY_SURFACE_MAP: Record<string, ThreatSurfaceKind> = {
  authentication: "session",
  authorization: "api",
  rest_api: "api",
  graphql: "api",
  payments: "business_workflow",
  webhooks: "webhook",
  llm: "prompt",
  mcp_servers: "mcp_server",
  storage: "persistence_boundary",
  admin_area: "configuration",
  file_uploads: "endpoint",
  background_jobs: "queue",
  third_party_services: "external_integration",
  browser: "browser_flow",
};

export function mapDiscoveryToSourceRefs(input: ThreatModelBuildInput): ThreatSourceReference[] {
  const refs: ThreatSourceReference[] = [];
  if (input.discovery) {
    refs.push({
      kind: "discovery",
      refId: input.discovery.reportId,
      label: "Discovery report",
    });
    for (const entry of input.discovery.potentialAttackSurface) {
      refs.push({
        kind: "discovery",
        refId: `${input.discovery.reportId}:${entry.area}`,
        label: entry.label,
      });
    }
  }
  if (input.platform?.missionControlPayload?.businessLogic) {
    refs.push({ kind: "platform_metadata", refId: "rt9-platform", label: "RT9 platform payload" });
  }
  if (input.platform?.missionControlPayload?.llm) {
    refs.push({ kind: "platform_metadata", refId: "rt10-platform", label: "RT10 platform payload" });
  }
  return refs.sort((a, b) => `${a.kind}:${a.refId}`.localeCompare(`${b.kind}:${b.refId}`));
}

export function evidenceFromSources(
  scope: ThreatScope,
  sources: ThreatSourceReference[],
  detail: string,
  confidence: CoreFindingConfidence
): ThreatEvidence {
  return {
    id: threatLogicalId(["evidence", scope.scanId, ...sources.map((s) => s.refId), detail]),
    sources,
    detail,
    confidence,
  };
}

export function discoverySurfaceKinds(
  input: ThreatModelBuildInput
): Array<{ kind: ThreatSurfaceKind; label: string; ref: ThreatSourceReference; confidence: CoreFindingConfidence }> {
  if (!input.discovery) return [];
  const out: Array<{
    kind: ThreatSurfaceKind;
    label: string;
    ref: ThreatSourceReference;
    confidence: CoreFindingConfidence;
  }> = [];
  for (const entry of input.discovery.potentialAttackSurface) {
    const kind = DISCOVERY_SURFACE_MAP[entry.area];
    if (!kind) continue;
    const ref: ThreatSourceReference = {
      kind: "discovery",
      refId: `${input.discovery.reportId}:${entry.area}`,
      label: entry.label,
    };
    const band: CoreFindingConfidence =
      entry.confidence >= 0.85 ? "high" : entry.confidence >= 0.65 ? "medium" : "low";
    out.push({ kind, label: entry.label, ref, confidence: band });
  }
  return out.sort((a, b) => `${a.kind}:${a.label}`.localeCompare(`${b.kind}:${b.label}`));
}

export function collectProtectedAssets(input: ThreatModelBuildInput): Array<{
  id: string;
  label: string;
  type: string;
  team: "rt9" | "rt10" | "shared";
  source: ThreatSourceReference;
}> {
  const assets: Array<{
    id: string;
    label: string;
    type: string;
    team: "rt9" | "rt10" | "shared";
    source: ThreatSourceReference;
  }> = [];
  for (const a of input.rt9?.protectedAssets ?? []) {
    assets.push({
      id: a.id,
      label: a.label,
      type: a.type ?? "business_asset",
      team: "rt9",
      source: { kind: "rt9_asset", refId: a.id, label: a.label },
    });
  }
  for (const a of input.rt10?.protectedAssets ?? []) {
    assets.push({
      id: a.id,
      label: a.label,
      type: a.type ?? "ai_asset",
      team: "rt10",
      source: { kind: "rt10_asset", refId: a.id, label: a.label },
    });
  }
  return assets.sort((a, b) => a.id.localeCompare(b.id));
}

export function hasCrossTeamEvidence(input: ThreatModelBuildInput): boolean {
  const rt9 =
    Boolean(input.rt9?.findingIds?.length) ||
    Boolean(input.rt9?.protectedAssets?.length) ||
    Boolean(input.rt9?.workflows);
  const rt10 =
    Boolean(input.rt10?.findingIds?.length) ||
    Boolean(input.rt10?.protectedAssets?.length) ||
    Boolean(input.rt10?.graphNodeIds?.length);
  const intelCross = (input.intelligence?.correlations ?? []).some(
    (c) =>
      c.kind === "cross_domain" ||
      (c.domains?.includes("payments") && c.domains?.includes("llm"))
  );
  return rt9 && rt10 && intelCross;
}

export function hasMinimumEvidence(input: ThreatModelBuildInput): boolean {
  const discoverySurfaces = input.discovery?.potentialAttackSurface?.length ?? 0;
  const rt9Evidence =
    (input.rt9?.findingIds?.length ?? 0) > 0 ||
    (input.rt9?.protectedAssets?.length ?? 0) > 0 ||
    (input.rt9?.invariants ?? 0) > 0;
  const rt10Evidence =
    (input.rt10?.findingIds?.length ?? 0) > 0 ||
    (input.rt10?.protectedAssets?.length ?? 0) > 0 ||
    (input.rt10?.boundaryIds?.length ?? 0) > 0;
  const platformPayload =
    Boolean(input.platform?.missionControlPayload?.businessLogic) ||
    Boolean(input.platform?.missionControlPayload?.llm);
  return discoverySurfaces > 0 && (rt9Evidence || rt10Evidence || platformPayload);
}
