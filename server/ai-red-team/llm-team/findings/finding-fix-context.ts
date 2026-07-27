import type { AIAttackCase } from "../attacks/attack.types";
import type { AIInvariant } from "../invariants/invariant.types";
import type { AIFindingRecommendation, AIFixContext } from "./finding.types";
import { stableAiId } from "../model/stable-id";

export function buildFixContext(input: {
  invariant: AIInvariant;
  attack: AIAttackCase | null;
}): AIFixContext {
  const recommendations: AIFindingRecommendation[] = [
    {
      id: stableAiId(`fix:restore:${input.invariant.invariantKey}`),
      kind: "restore_invariant",
      statement: `Restore invariant: ${input.invariant.title}`,
    },
  ];

  let promptLayer: string | null = null;
  let memoryLayer: string | null = null;
  let toolLayer: string | null = null;
  let retrievalLayer: string | null = null;
  let guardrail: string | null = null;
  let isolation: string | null = null;

  switch (input.invariant.category) {
    case "prompt_integrity":
    case "instruction_priority":
    case "system_prompt_integrity":
      promptLayer = "Enforce hierarchical prompt assembly with untrusted user isolation.";
      recommendations.push({
        id: stableAiId(`fix:prompt:${input.invariant.invariantKey}`),
        kind: "prompt_hardening",
        statement: "Add instruction firewall between user content and system policy.",
      });
      break;
    case "memory_isolation":
    case "memory_ownership":
      memoryLayer = "Scope memory reads/writes to tenant and session identifiers.";
      isolation = "Strict memory tenant isolation and write validation.";
      recommendations.push({
        id: stableAiId(`fix:mem:${input.invariant.invariantKey}`),
        kind: "memory_isolation",
        statement: "Validate memory ownership before persistence.",
      });
      break;
    case "tool_authorization":
    case "tool_isolation":
      toolLayer = "Server-side tool allowlists bound to authenticated principal.";
      recommendations.push({
        id: stableAiId(`fix:tool:${input.invariant.invariantKey}`),
        kind: "tool_authorization",
        statement: "Authorize tool calls independently of model output.",
      });
      break;
    case "retrieval_integrity":
    case "retrieval_authenticity":
      retrievalLayer = "Sign or sandbox retrieved chunks before LLM injection.";
      recommendations.push({
        id: stableAiId(`fix:rag:${input.invariant.invariantKey}`),
        kind: "retrieval_integrity",
        statement: "Validate retrieval provenance and tenant scope.",
      });
      break;
    case "guardrail_integrity":
    case "moderation_integrity":
      guardrail = "Non-skippable moderation and guardrail chain on all output paths.";
      recommendations.push({
        id: stableAiId(`fix:guard:${input.invariant.invariantKey}`),
        kind: "guardrail_enforcement",
        statement: "Enforce output filters before streaming to clients.",
      });
      break;
    case "mcp_isolation":
      isolation = "Isolate MCP servers from direct user prompt channels.";
      recommendations.push({
        id: stableAiId(`fix:mcp:${input.invariant.invariantKey}`),
        kind: "mcp_isolation",
        statement: "MCP client must sanitize and scope server-bound payloads.",
      });
      break;
    case "agent_isolation":
    case "agent_delegation":
      isolation = "Cap delegation depth and bind agent identity.";
      recommendations.push({
        id: stableAiId(`fix:agent:${input.invariant.invariantKey}`),
        kind: "agent_isolation",
        statement: "Limit agent tool reach via capability tokens.",
      });
      break;
    default:
      break;
  }

  return {
    affectedComponentNodeIds: input.invariant.relationships.protectedComponentNodeIds,
    affectedTrustBoundaryId: input.invariant.protectedTrustBoundaryId,
    invariantToRestoreId: input.invariant.id,
    invariantToRestoreKey: input.invariant.invariantKey,
    promptLayer,
    memoryLayer,
    toolLayer,
    retrievalLayer,
    guardrailRecommendation: guardrail,
    isolationRecommendation: isolation,
    validationRecommendation:
      input.attack?.suggestedRuntimeStrategy ??
      "Re-validate invariant under safe synthetic runtime after remediation.",
    recommendations,
  };
}
