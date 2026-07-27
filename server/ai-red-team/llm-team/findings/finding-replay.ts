import type { AIAttackCase } from "../attacks/attack.types";
import type { AIInvariant } from "../invariants/invariant.types";
import type { AIExecutionResult } from "../runtime/runtime.types";
import type { AttackPreconditions, AIReplayAction, AIReplayPlan } from "./finding.types";
import { stableAiId } from "../model/stable-id";

export function buildReplayPlan(input: {
  findingId: string;
  invariant: AIInvariant;
  attack: AIAttackCase | null;
  execution: AIExecutionResult;
  preconditions: AttackPreconditions;
}): AIReplayPlan {
  const filteredPrompts =
    input.attack?.sequence.steps
      .filter((s) => s.nodeKind === "user_prompt" || s.nodeKind === "attack" || s.nodeKind === "user")
      .map((s) => s.label) ?? [];
  const promptSequence =
    filteredPrompts.length > 0
      ? filteredPrompts
      : (input.attack?.sequence.steps.map((s) => s.label).slice(0, 3) ?? ["Synthetic user turn"]);

  const replaySteps: AIReplayAction[] =
    input.attack?.sequence.steps.map((s, i) => ({
      id: stableAiId(`replay:${input.findingId}:${i}`),
      order: i + 1,
      kind:
        s.nodeKind === "tool"
          ? ("tool_invoke" as const)
          : s.nodeKind === "memory"
            ? ("memory_write" as const)
            : s.nodeKind === "retrieved_context"
              ? ("retrieval" as const)
              : s.nodeKind === "mcp_client" || s.nodeKind === "mcp_server"
                ? ("mcp_call" as const)
                : ("prompt_turn" as const),
      label: s.label,
      nodeId: s.nodeId,
    })) ?? [];

  replaySteps.push({
    id: stableAiId(`replay:${input.findingId}:assert`),
    order: replaySteps.length + 1,
    kind: "assert_invariant",
    label: `Expect violation: ${input.invariant.title}`,
    nodeId: null,
  });

  return {
    id: stableAiId(`replay-plan:${input.findingId}`),
    findingId: input.findingId,
    preconditions: input.preconditions,
    promptSequence,
    conversationState: input.preconditions.requiredConversationState.map((s) => s.description),
    memoryState: input.preconditions.requiredMemoryState.map((s) => s.description),
    retrievedContext: input.preconditions.requiredRetrievalState.map((s) => s.description),
    toolState: input.preconditions.requiredToolPermissions,
    sequence: {
      id: stableAiId(`replay-seq:${input.findingId}`),
      steps: replaySteps,
    },
    expectedInvariantViolationId: input.invariant.id,
    expectedEvidence: input.execution.evidence.slice(0, 5).map((e) => ({
      id: stableAiId(`replay-ev:${e.id}`),
      detail: e.detail,
      refId: e.refId ?? null,
    })),
    expectedOutcome:
      input.execution.expectedImpact ??
      input.attack?.expectedImpact ??
      "Invariant violation reproduced under replay preconditions.",
    executable: false,
  };
}
