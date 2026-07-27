import type { AdapterOutput, UniversalEngineeringPlan, VerificationEngineeringPlan } from "../uee.types";

export function engineeringPlanToJson(plan: UniversalEngineeringPlan): AdapterOutput {
  const content = JSON.stringify(plan, null, 2);
  return {
    adapterId: "json",
    format: "json",
    content,
    tokenEstimate: Math.ceil(content.length / 4),
    generationTimeMs: 0,
  };
}

export function engineeringPlanToYaml(plan: UniversalEngineeringPlan): AdapterOutput {
  const lines: string[] = ["planId: " + plan.planId, "version: " + plan.version, "summary: >", "  " + plan.summary];
  lines.push("objectives:");
  for (const o of plan.objectives) lines.push("  - " + quoteYaml(o));
  lines.push("rootCauses:");
  for (const r of plan.rootCauses) {
    lines.push("  - id: " + r.id);
    lines.push("    title: " + quoteYaml(r.title));
  }
  lines.push("implementationOrder:");
  for (const step of plan.implementationOrder) {
    lines.push("  - stepId: " + step.stepId);
    lines.push("    title: " + quoteYaml(step.title));
  }
  const content = lines.join("\n");
  return {
    adapterId: "yaml",
    format: "yaml",
    content,
    tokenEstimate: Math.ceil(content.length / 4),
    generationTimeMs: 0,
  };
}

function quoteYaml(value: string): string {
  if (/[:#]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

export function engineeringPlanToMarkdown(plan: UniversalEngineeringPlan): AdapterOutput {
  const content = `# Engineering Plan

${plan.summary}

## Objectives
${plan.objectives.map((o) => `- ${o}`).join("\n")}

## Attack summary
${plan.attackSummary}

## Root causes
${plan.rootCauses.map((r) => `- **${r.title}** — ${r.description}`).join("\n")}

## Implementation order
${plan.implementationOrder.map((s, i) => `${i + 1}. ${s.title} (${s.stepId})`).join("\n")}

## Definition of Done
${plan.definitionOfDone.map((d) => `- ${d}`).join("\n")}
`;
  return {
    adapterId: "generic_markdown",
    format: "markdown",
    content,
    tokenEstimate: Math.ceil(content.length / 4),
    generationTimeMs: 0,
  };
}

export function engineeringPlanToRestResponse(input: {
  plan: UniversalEngineeringPlan;
  verificationPlan: VerificationEngineeringPlan;
}): AdapterOutput {
  const content = JSON.stringify(
    {
      engineeringPlan: input.plan,
      verificationPlan: input.verificationPlan,
      replayRequired: true,
    },
    null,
    2
  );
  return {
    adapterId: "rest",
    format: "json",
    content,
    tokenEstimate: Math.ceil(content.length / 4),
    generationTimeMs: 0,
  };
}

export function engineeringPlanToMcpResponse(input: {
  plan: UniversalEngineeringPlan;
  primaryPrompt: string | null;
}): AdapterOutput {
  const content = JSON.stringify(
    {
      type: "sequrai_engineering_plan",
      plan: input.plan,
      implementationPrompt: input.primaryPrompt,
      replayMandatory: true,
    },
    null,
    2
  );
  return {
    adapterId: "mcp",
    format: "json",
    content,
    tokenEstimate: Math.ceil(content.length / 4),
    generationTimeMs: 0,
  };
}
