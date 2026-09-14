import "server-only";

import { randomUUID } from "node:crypto";
import { listExternalAndNativeAdjacentEngines } from "@/server/security-engines/registry";
import type { EngineId } from "@/server/security-engines/types";
import type { ApplicationSurface, PlannedEngineDecision, ScanDepth, SecurityPlan } from "./types";

/**
 * Phase 36, section 7: capability-driven engine selection. Deliberately
 * does NOT re-derive applicability -- every engine already implements
 * applicability() (Phase 35's SecurityEngine contract); this function is
 * the single place that calls it for every registered engine and turns the
 * result into an explainable decision. "native" is not modeled as a
 * SecurityEngine (Phase 35's own design note: it stays on its own existing
 * pipeline) but is always planned -- it has no external dependency and
 * already runs on every scan.
 */

const QUICK_ENGINES: ReadonlySet<EngineId> = new Set(["native", "crypto"]);

function isEngineIncludedAtDepth(engine: EngineId, depth: ScanDepth): boolean {
  if (depth === "QUICK") return QUICK_ENGINES.has(engine);
  // STANDARD, DEEP, and AUTONOMOUS all include every applicable engine for
  // static analysis -- DEEP/AUTONOMOUS differ in the investigation/dynamic
  // stages (adaptive-investigation.ts), not in which static engines run.
  return true;
}

export function buildSecurityPlan(input: {
  scanId: string;
  organizationId: string;
  projectId: string;
  applicationSurface: ApplicationSurface;
  files: Array<{ path: string; content: string }>;
  depth?: ScanDepth;
}): SecurityPlan {
  const depth = input.depth ?? "STANDARD";
  const decisions: PlannedEngineDecision[] = [
    {
      engine: "native",
      selected: isEngineIncludedAtDepth("native", depth),
      capabilities: ["secrets", "authentication", "authorization", "injection", "mcp-security", "ai-security", "ci-cd"],
      rationale: "Native 47-rule scanner always runs -- no external dependency, no applicability gate.",
    },
  ];

  for (const engine of listExternalAndNativeAdjacentEngines()) {
    const applicability = engine.applicability({ files: input.files, githubRepo: input.applicationSurface.githubRepo });
    const includedAtDepth = isEngineIncludedAtDepth(engine.id, depth);
    decisions.push({
      engine: engine.id,
      selected: applicability.applicable && includedAtDepth,
      capabilities: applicability.matchedCapabilities,
      rationale: applicability.applicable
        ? includedAtDepth
          ? applicability.reason
          : `${applicability.reason} -- excluded at ${depth} depth`
        : applicability.reason,
    });
  }

  const dynamicDecision = resolveDynamicTestingAvailability(input.applicationSurface, depth);

  return {
    planId: randomUUID(),
    scanId: input.scanId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    applicationSurface: input.applicationSurface,
    depth,
    decisions,
    selectedEngines: decisions.filter((d) => d.selected).map((d) => d.engine),
    dynamicTestingAvailable: dynamicDecision.available,
    dynamicTestingReason: dynamicDecision.reason,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Section 12/15: AUTONOMOUS depth is where dynamic testing would apply --
 * but Phase 35.5's network_policy is descriptive, not enforced (confirmed
 * in that phase's own report), so it is never marked available here
 * regardless of depth. This is the one place that distinction is enforced
 * for planning purposes.
 */
function resolveDynamicTestingAvailability(
  surface: ApplicationSurface,
  depth: ScanDepth
): { available: boolean; reason: string } {
  if (depth !== "AUTONOMOUS") {
    return { available: false, reason: `Dynamic testing is only considered at AUTONOMOUS depth (this plan is ${depth}).` };
  }
  return {
    available: false,
    reason:
      "Dynamic testing is not available: Phase 35.5's network_policy is descriptive metadata only, not enforced at the OS/container level yet. Enabling it here would turn a recorded policy into a false security control.",
  };
}
