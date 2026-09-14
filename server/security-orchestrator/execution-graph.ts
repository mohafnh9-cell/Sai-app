import "server-only";

import type { ExecutionGraph, SecurityPlan } from "./types";

/**
 * Phase 36, section 9: a real staged graph, not a flat scanner list.
 * STATIC_ANALYSIS's engines all run in parallel (section 10) -- they share
 * no dependency on each other, only on DISCOVERY having produced the
 * ApplicationSurface/SecurityPlan they were selected from.
 */
export function buildExecutionGraph(plan: SecurityPlan): ExecutionGraph {
  return {
    planId: plan.planId,
    stages: [
      { id: "DISCOVERY", engines: [], dependsOn: [] },
      { id: "STATIC_ANALYSIS", engines: plan.selectedEngines, dependsOn: ["DISCOVERY"] },
      { id: "NORMALIZATION_CORRELATION", engines: [], dependsOn: ["STATIC_ANALYSIS"] },
      { id: "ATTACK_CHAIN_ANALYSIS", engines: [], dependsOn: ["NORMALIZATION_CORRELATION"] },
      { id: "ADAPTIVE_INVESTIGATION", engines: [], dependsOn: ["ATTACK_CHAIN_ANALYSIS"] },
      { id: "AI_REASONING", engines: [], dependsOn: ["ADAPTIVE_INVESTIGATION"] },
      { id: "PRODUCTION_VERDICT", engines: [], dependsOn: ["AI_REASONING"] },
    ],
  };
}
