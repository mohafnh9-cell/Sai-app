import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { AiProviderClient, StructuredReasoningRequest } from "../types";

/**
 * Phase 37: real Anthropic provider. API key is read server-side only
 * (ANTHROPIC_API_KEY) -- never exposed to the browser, MCP client,
 * repository, or accepted as a tool argument.
 */
export function createAnthropicProvider(model: string): AiProviderClient {
  return {
    id: "anthropic",
    async generateStructured(request: StructuredReasoningRequest) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
      }
      const client = new Anthropic({ apiKey, timeout: request.timeoutMs, maxRetries: 1 });
      const response = await client.messages.create({
        model,
        max_tokens: request.maxTokens,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.userPrompt }],
      });
      const textBlock = response.content.find((block) => block.type === "text");
      const rawText = textBlock && "text" in textBlock ? textBlock.text : "";
      return {
        rawText,
        usage: { inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens },
      };
    },
  };
}
