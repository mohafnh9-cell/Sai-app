import type { AttackResult } from "../types";
import type { DiscoveryReport } from "../discovery/types";
import type { IntelligenceAttackGraph, IntelligenceGraphEdge, IntelligenceGraphNode } from "./models";
import type { NormalizedObservation } from "./models";
import { normalizeObservations } from "./normalize-observations";

export function buildIntelligenceAttackGraph(input: {
  discovery: DiscoveryReport;
  results: AttackResult[];
  observations: NormalizedObservation[];
}): IntelligenceAttackGraph {
  const nodes: IntelligenceGraphNode[] = [];
  const edges: IntelligenceGraphEdge[] = [];

  const addNode = (node: IntelligenceGraphNode) => {
    if (!nodes.some((n) => n.id === node.id)) nodes.push(node);
  };

  for (const tech of input.discovery.detectedTechnologies) {
    addNode({
      id: `tech:${tech.id}`,
      kind: tech.category === "payments" ? "payment" : tech.category === "auth" ? "authentication" : "framework",
      label: tech.name,
      domain: tech.category,
      metadata: { confidence: tech.confidence },
    });
  }

  for (const surface of input.discovery.potentialAttackSurface) {
    addNode({
      id: `surface:${surface.area}`,
      kind: surface.area === "authentication" ? "authentication" : "component",
      label: surface.label,
      metadata: { area: surface.area, confidence: surface.confidence },
    });
  }

  for (const obs of input.observations) {
    addNode({
      id: `finding:${obs.id}`,
      kind: "finding",
      label: obs.title,
      domain: obs.domain,
      metadata: {
        severity: obs.severity,
        route: obs.route,
        team: obs.team,
        specialist: obs.specialist,
      },
    });

    if (obs.route) {
      const routeId = `route:${obs.route}`;
      addNode({ id: routeId, kind: "route", label: obs.route });
      edges.push({ from: routeId, to: `finding:${obs.id}`, kind: "exposes", weight: 1 });
    }

    for (const key of obs.correlationKeys) {
      const ctxId = `context:${key}`;
      addNode({ id: ctxId, kind: "configuration", label: key });
      edges.push({ from: ctxId, to: `finding:${obs.id}`, kind: "shares_context", weight: 0.8 });
    }
  }

  if (input.discovery.payments.length > 0) {
    const payId = `payment:stripe`;
    addNode({ id: payId, kind: "payment", label: "Payments" });
    const authSurface = nodes.find((n) => n.id === "surface:authentication");
    if (authSurface) {
      edges.push({ from: authSurface.id, to: payId, kind: "reachable_from", weight: 0.6 });
    }
  }

  if (input.discovery.potentialAttackSurface.some((s) => s.area === "admin_area")) {
    addNode({ id: "privilege:admin", kind: "privilege", label: "Admin access" });
    const auth = nodes.find((n) => n.id === "surface:authentication");
    if (auth) {
      edges.push({ from: auth.id, to: "privilege:admin", kind: "escalates_to", weight: 0.7 });
    }
  }

  return { nodes, edges };
}

export function buildGraphFromRun(input: {
  discovery: DiscoveryReport;
  results: AttackResult[];
}): IntelligenceAttackGraph {
  const observations = normalizeObservations(input.results);
  return buildIntelligenceAttackGraph({
    discovery: input.discovery,
    results: input.results,
    observations,
  });
}
