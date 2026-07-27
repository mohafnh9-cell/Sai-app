import { createHash } from "node:crypto";
import type {
  AttackCampaign,
  EngineeringPlan,
  GroupedFix,
  RootCause,
} from "../fix-strategy.types";
import type { DiscoveryReport } from "../../discovery/types";
import { rootCauseBullets, summarizeCampaignForPrompt } from "../architecture/architecture-context";

export function buildImplementationPrompt(input: {
  projectSummary: string;
  discovery: DiscoveryReport;
  campaign: AttackCampaign;
  rootCauses: RootCause[];
  groupedFixes: GroupedFix[];
  engineeringPlan: EngineeringPlan;
}): string {
  const rootBullets = rootCauseBullets(input.rootCauses);
  const fixSections = input.groupedFixes.map(
    (fix, i) =>
      `${i + 1}. **${fix.title}** (${fix.recommendedVariant})\n   - Findings: ${fix.findingIds.length}\n   - Likely files: ${fix.likelyFiles.join(", ")}\n   - Summary: ${fix.summary}`
  );

  return `# SequrAI Engineering Fix

## Project summary
${input.projectSummary || input.discovery.projectSummary || "Application under SequrAI authorized security review."}

## Security objective
Eliminate the attack campaign below with the smallest safe change set. Do not expand scope beyond listed root causes.

## Attack Campaign summary
Goal: ${input.campaign.goal}

${summarizeCampaignForPrompt(input.campaign)}

## Root Causes
${rootBullets.map((b) => `- ${b}`).join("\n")}

## Required changes
${fixSections.join("\n\n")}

## Constraints
${input.engineeringPlan.constraints.map((c) => `- ${c}`).join("\n")}
- Never delete code blindly or replace frameworks.
- Never grant elevated privileges in tests against production data.
- Preserve existing APIs unless strictly required for security.

## Architecture considerations
${input.engineeringPlan.architectureNotes.map((n) => `- ${n}`).join("\n")}

## Implementation order
${input.engineeringPlan.implementationOrder.map((id, i) => `${i + 1}. ${id}`).join("\n")}

## Testing requirements
- Add regression tests for each root cause area (auth, authorization, API, browser as applicable).
- Preserve all existing tests; fix failures without weakening assertions.

## Regression requirements
- Re-run authorized replay scenarios; attacks must fail after fix.
- Confirm no new linter or type errors.

## Definition of Done
- Modified files listed in commit message
- New tests cover each grouped fix
- Migration summary if database policies changed
- Remaining risks documented briefly

Return:
- Modified files
- New tests
- Migration summary
- Remaining risks
`;
}

export function buildVerificationPrompt(input: {
  campaign: AttackCampaign;
  groupedFixes: GroupedFix[];
  implementationPromptHash: string;
}): string {
  return `# SequrAI Fix Verification

Review all changes introduced for strategy hash \`${input.implementationPromptHash.slice(0, 12)}\`.

## Attack Campaign
${summarizeCampaignForPrompt(input.campaign)}

## Verify
1. Every grouped fix is addressed:
${input.groupedFixes.map((f) => `- ${f.fixId}: ${f.title}`).join("\n")}
2. Replay attacks fail (403/denied) where previously successful.
3. No regression in existing unit/integration tests.
4. Public API contracts unchanged unless documented.

Run tests and explain any remaining risks in plain language.
`;
}

export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}
