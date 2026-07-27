import type { DiscoveryReport } from "../../discovery/types";
import type { AttackCampaign, EngineeringPlan, GroupedFix, RootCause } from "../fix-strategy.types";

export function buildArchitectureContext(discovery: DiscoveryReport): {
  notes: string[];
  preserve: string[];
} {
  const notes: string[] = [];
  const preserve: string[] = [
    "Preserve existing public API routes and response shapes unless a finding proves unsafe defaults.",
    "Prefer incremental changes over module rewrites.",
    "Do not remove existing security checks without equivalent replacement.",
  ];

  for (const tech of discovery.detectedTechnologies) {
    notes.push(`Stack signal: ${tech.name} (${tech.category})`);
  }
  if (discovery.authenticationProviders.length > 0) {
    preserve.push("Preserve current authentication provider integration and session contract.");
  }
  if (discovery.payments.length > 0) {
    preserve.push("Preserve payment webhooks and idempotency behavior.");
  }

  return { notes, preserve };
}

export function buildEngineeringPlan(input: {
  groupedFixes: GroupedFix[];
  architectureNotes: string[];
}): EngineeringPlan {
  const implementationOrder = input.groupedFixes
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .map((f) => f.fixId);

  return {
    implementationOrder,
    constraints: [
      "Minimize diff size; avoid unrelated refactors.",
      "Maintain backward compatibility for existing clients.",
      "Use existing project conventions for auth, logging, and errors.",
    ],
    architectureNotes: input.architectureNotes,
    migrationRequired: input.groupedFixes.some((f) => f.likelyFiles.some((p) => p.includes("migration"))),
    backwardCompatible: true,
  };
}

export function summarizeCampaignForPrompt(campaign: AttackCampaign): string {
  return campaign.steps.map((s) => s.label).join("\n↓\n");
}

export function rootCauseBullets(causes: RootCause[]): string[] {
  return causes.map((c) => `${c.title} (${c.findingIds.length} findings)`);
}
