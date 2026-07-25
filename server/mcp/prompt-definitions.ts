/**
 * Optional MCP prompts — orchestration hints only, no product truth.
 * Clients with prompts/list support can expose these; others use tool descriptions + instructions.
 */

export type McpPromptDefinition = {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required?: boolean }>;
  suggestedToolSequence: string[];
};

export const MCP_PROMPT_DEFINITIONS: McpPromptDefinition[] = [
  {
    name: "prepare_for_deploy",
    description:
      "Prepare to ship: ask can_i_deploy first; if not comfortable or stale, guide review_now then safe_fix. Speaks as SequrAI engineer.",
    arguments: [
      { name: "projectId", description: "SequrAI project ID (optional if single project)." },
    ],
    suggestedToolSequence: ["can_i_deploy", "review_now", "safe_fix"],
  },
  {
    name: "review_latest_work",
    description:
      "Fresh protection review on latest work, then deploy answer. review_now then can_i_deploy.",
    arguments: [
      { name: "projectId", description: "SequrAI project ID (optional if single project)." },
    ],
    suggestedToolSequence: ["review_now", "can_i_deploy"],
  },
  {
    name: "fix_top_blocker",
    description:
      "Fix what worries SequrAI most: can_i_deploy or safe_fix, then safe_fix with blocker.",
    arguments: [
      { name: "projectId", description: "SequrAI project ID (optional if single project)." },
    ],
    suggestedToolSequence: ["can_i_deploy", "safe_fix"],
  },
];

export function mcpPromptMessage(name: string): string | null {
  const prompt = MCP_PROMPT_DEFINITIONS.find((item) => item.name === name);
  if (!prompt) return null;
  return [
    "SEQURAI",
    "",
    prompt.name.toUpperCase().replace(/_/g, " "),
    "",
    prompt.description,
    "",
    `Suggested tool sequence: ${prompt.suggestedToolSequence.join(" → ")}`,
    "Select tools based on user context. Do not skip freshness checks.",
  ].join("\n");
}
