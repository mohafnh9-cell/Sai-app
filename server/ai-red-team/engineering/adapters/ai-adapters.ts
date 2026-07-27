import type { AdapterOutput, PreferredAI, UniversalEngineeringPlan, VerificationEngineeringPlan } from "../uee.types";

export type AiAdapterContext = {
  projectSummary: string;
  plan: UniversalEngineeringPlan;
  verificationPlan: VerificationEngineeringPlan;
};

export type AiAdapter = {
  id: PreferredAI;
  render(ctx: AiAdapterContext): Omit<AdapterOutput, "generationTimeMs">;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sharedSections(ctx: AiAdapterContext) {
  const { plan } = ctx;
  return {
    context: ctx.projectSummary || plan.summary,
    securityObjective: plan.objectives.join(" "),
    attackSummary: plan.attackSummary,
    rootCauses: plan.rootCauses.map((r) => `- ${r.title} (${r.findingIds.length} findings)`).join("\n"),
    strategy: plan.selectedStrategy.replace(/_/g, " "),
    constraints: plan.constraints.map((c) => `- ${c}`).join("\n"),
    files: plan.affectedFiles.join(", "),
    tests: plan.requiredTests.map((t) => `- ${t}`).join("\n"),
    regression: plan.regressionTests.map((t) => `- ${t.title}`).join("\n"),
    dod: plan.definitionOfDone.map((d) => `- ${d}`).join("\n"),
    steps: plan.implementationOrder
      .map((s, i) => `${i + 1}. ${s.title} — ${s.why}`)
      .join("\n"),
  };
}

function basePrompt(ctx: AiAdapterContext, header: string, footer: string): string {
  const s = sharedSections(ctx);
  return `${header}

## Project context
${s.context}

## Security objective
${s.securityObjective}

## Attack summary
${s.attackSummary}

## Root causes
${s.rootCauses}

## Implementation strategy (${s.strategy})
${s.steps}

## Constraints
${s.constraints}

## Architecture preservation
${ctx.plan.architectureChanges.map((a) => `- ${a.title}: ${a.rationale}`).join("\n")}

## Files likely affected
${s.files}

## Testing requirements
${s.tests}

## Regression requirements
${s.regression}

## Definition of Done
${s.dod}

## Expected output
- Modified files list
- New tests
- Migration summary (if any)
- Remaining risks

${footer}`;
}

export const cursorAdapter: AiAdapter = {
  id: "cursor",
  render(ctx) {
    const content = basePrompt(
      ctx,
      "# Engineering remediation (Cursor)",
      "Follow repository conventions. Make minimal focused edits."
    );
    return { adapterId: "cursor", format: "prompt", content, tokenEstimate: estimateTokens(content) };
  },
};

export const claudeCodeAdapter: AiAdapter = {
  id: "claude_code",
  render(ctx) {
    const content = basePrompt(
      ctx,
      "# Engineering remediation (Claude Code)",
      "Think step-by-step internally but output only implementation artifacts and a concise summary."
    );
    return { adapterId: "claude_code", format: "prompt", content, tokenEstimate: estimateTokens(content) };
  },
};

export const codexAdapter: AiAdapter = {
  id: "codex",
  render(ctx) {
    const content = basePrompt(
      ctx,
      "# Engineering remediation (Codex)",
      "Prefer precise patches. Do not refactor unrelated modules."
    );
    return { adapterId: "codex", format: "prompt", content, tokenEstimate: estimateTokens(content) };
  },
};

export const geminiAdapter: AiAdapter = {
  id: "gemini",
  render(ctx) {
    const content = basePrompt(
      ctx,
      "# Engineering remediation (Gemini CLI)",
      "Use tool calls for file edits where available; keep changes incremental."
    );
    return { adapterId: "gemini", format: "prompt", content, tokenEstimate: estimateTokens(content) };
  },
};

export const copilotAdapter: AiAdapter = {
  id: "copilot",
  render(ctx) {
    const content = basePrompt(
      ctx,
      "# Engineering remediation (GitHub Copilot)",
      "Suggest edits inline; preserve existing patterns in this repository."
    );
    return { adapterId: "copilot", format: "prompt", content, tokenEstimate: estimateTokens(content) };
  },
};

export const aiderAdapter: AiAdapter = {
  id: "aider",
  render(ctx) {
    const content = basePrompt(
      ctx,
      "# Engineering remediation (Aider)",
      "Propose a git-compatible patch series with tests."
    );
    return { adapterId: "aider", format: "prompt", content, tokenEstimate: estimateTokens(content) };
  },
};

export const continueAdapter: AiAdapter = {
  id: "continue",
  render(ctx) {
    const content = basePrompt(
      ctx,
      "# Engineering remediation (Continue)",
      "Use @codebase context; apply smallest safe diff."
    );
    return { adapterId: "continue", format: "prompt", content, tokenEstimate: estimateTokens(content) };
  },
};

export const clineAdapter: AiAdapter = {
  id: "cline",
  render(ctx) {
    const content = basePrompt(
      ctx,
      "# Engineering remediation (Cline)",
      "Use structured tool steps; confirm each step against constraints before proceeding."
    );
    return { adapterId: "cline", format: "prompt", content, tokenEstimate: estimateTokens(content) };
  },
};

export const rooAdapter: AiAdapter = {
  id: "roo",
  render(ctx) {
    const content = basePrompt(
      ctx,
      "# Engineering remediation (Roo Code)",
      "Execute in modes: plan briefly, then implement, then verify tests."
    );
    return { adapterId: "roo", format: "prompt", content, tokenEstimate: estimateTokens(content) };
  },
};

export const openaiAgentAdapter: AiAdapter = {
  id: "openai_agent",
  render(ctx) {
    const content = `# Agent instructions

Goal: ${ctx.plan.objectives[0]}

## Attack summary
${ctx.plan.attackSummary}

## Tasks
${ctx.plan.implementationOrder.map((s) => `- ${s.stepId}: ${s.title}`).join("\n")}

## Constraints
${ctx.plan.constraints.join("\n")}

## Verification plan
${ctx.verificationPlan.replayValidation.join("\n")}

## Done when
${ctx.plan.definitionOfDone.join("\n")}`;
    return {
      adapterId: "openai_agent",
      format: "instructions",
      content,
      tokenEstimate: estimateTokens(content),
    };
  },
};

export const ALL_AI_ADAPTERS: AiAdapter[] = [
  cursorAdapter,
  claudeCodeAdapter,
  codexAdapter,
  geminiAdapter,
  copilotAdapter,
  aiderAdapter,
  continueAdapter,
  clineAdapter,
  rooAdapter,
  openaiAgentAdapter,
];

export function getAdapter(id: PreferredAI): AiAdapter | undefined {
  return ALL_AI_ADAPTERS.find((a) => a.id === id);
}

export function renderVerificationPrompt(ctx: AiAdapterContext, adapterId: PreferredAI): string {
  const v = ctx.verificationPlan;
  return `# Verification (${adapterId})

${v.summary}

## Security verification
${v.securityVerification.map((x) => `- ${x}`).join("\n")}

## Replay validation
${v.replayValidation.map((x) => `- ${x}`).join("\n")}

## Regression testing
${v.regressionTesting.map((x) => `- ${x}`).join("\n")}

## Architecture validation
${v.architectureValidation.map((x) => `- ${x}`).join("\n")}

Replay status required: passed before production deploy.
`;
}
