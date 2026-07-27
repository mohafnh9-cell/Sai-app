import { createHash } from "node:crypto";
import { stableAiId } from "../model/stable-id";

export type SyntheticPromptLayer = {
  role: "system" | "developer" | "user" | "retrieved_context" | "memory" | "tool_result";
  content: string;
};

export type SyntheticLlmTurn = {
  digest: string;
  response: string;
  followedInjection: boolean;
};

export class SyntheticLlmSession {
  readonly prompts: SyntheticPromptLayer[] = [];
  readonly turns: SyntheticLlmTurn[] = [];
  private promptCount = 0;

  addPrompt(layer: SyntheticPromptLayer): void {
    this.prompts.push(layer);
    this.promptCount += 1;
  }

  get promptTotal(): number {
    return this.promptCount;
  }

  /** Deterministic synthetic completion — never calls external providers. */
  complete(input: { userPayload: string; systemPolicy: string }): SyntheticLlmTurn {
    const digest = createHash("sha256")
      .update(`${input.systemPolicy}|${input.userPayload}`)
      .digest("hex")
      .slice(0, 16);

    const injectionMarkers = ["ignore previous", "system:", "override instructions", "disregard"];
    const followedInjection = injectionMarkers.some((m) =>
      input.userPayload.toLowerCase().includes(m)
    );

    const response = followedInjection
      ? `[SYNTHETIC] Policy conflict detected — attacker instruction would merge (${digest}).`
      : `[SYNTHETIC] Compliant response bound to policy (${digest}).`;

    const turn = { digest, response, followedInjection };
    this.turns.push(turn);
    return turn;
  }
}

export function syntheticResponseDigest(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

export function evidenceFromSynthetic(detail: string, confidence: number, refId?: string) {
  return {
    id: stableAiId(`rt-ev:syn:${detail}`),
    source: "synthetic_llm" as const,
    detail,
    confidence,
    refId: refId ?? null,
  };
}
