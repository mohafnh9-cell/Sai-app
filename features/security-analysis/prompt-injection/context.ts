import { LLM_INTEGRATION_INDICATORS } from "./constants";
import type { FileContext, FileContextKind, PromptInjectionTier } from "./types";

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function hasLlmIntegration(content: string): boolean {
  return LLM_INTEGRATION_INDICATORS.some((pattern) => pattern.test(content));
}

export function classifyFileContext(path: string, content: string): FileContext {
  const lowerPath = path.toLowerCase();
  const name = basename(lowerPath);

  if (/\.(md|mdx|rst|txt)$/i.test(path) || /(^|\/)docs?\//.test(lowerPath) || /^readme/i.test(name)) {
    return {
      kind: "documentation",
      isLlmRelated: hasLlmIntegration(content),
      suppressContentRules: true,
      confidenceMultiplier: 0.2,
    };
  }

  if (/__tests__|(^|\/)tests?\/|\.test\.|\.spec\.|\.stories\.|(^|\/)e2e\//i.test(lowerPath)) {
    return {
      kind: "test",
      isLlmRelated: hasLlmIntegration(content),
      suppressContentRules: false,
      confidenceMultiplier: 0.35,
    };
  }

  if (/(^|\/)fixtures?\/|(^|\/)examples?\//i.test(lowerPath) || /fixture|example|sample|mock/i.test(name)) {
    return {
      kind: "fixture",
      isLlmRelated: hasLlmIntegration(content),
      suppressContentRules: false,
      confidenceMultiplier: 0.35,
    };
  }

  const llmRelated = hasLlmIntegration(content);
  return {
    kind: llmRelated ? "llm-construction" : "source",
    isLlmRelated: llmRelated,
    suppressContentRules: !llmRelated,
    confidenceMultiplier: llmRelated ? 1 : 0.5,
  };
}

export function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("--")
  );
}

export function lineContextKind(line: string, fileKind: FileContextKind): FileContextKind {
  if (isCommentLine(line)) return "comment";
  if (/['"`][^'"`]*(ignore previous|system prompt|you are now)/i.test(line)) {
    return "prompt-literal";
  }
  return fileKind;
}

export function adjustConfidence(
  base: "HIGH" | "MEDIUM" | "LOW",
  multiplier: number
): "HIGH" | "MEDIUM" | "LOW" {
  if (multiplier >= 0.9) return base;
  if (multiplier <= 0.4) return "LOW";
  if (base === "HIGH" && multiplier < 0.75) return "MEDIUM";
  if (base === "MEDIUM" && multiplier < 0.5) return "LOW";
  return base;
}

export function tierFromContext(
  baseTier: PromptInjectionTier,
  context: FileContext,
  lineKind: FileContextKind
): PromptInjectionTier {
  if (context.kind === "documentation" || lineKind === "comment") {
    return "potential-pattern";
  }
  if (context.kind === "test" || context.kind === "fixture") {
    return baseTier === "likely-exploitable" ? "suspicious-construction" : "potential-pattern";
  }
  return baseTier;
}

export function shouldSkipPath(path: string): boolean {
  return path.split("/").some((segment) =>
    ["node_modules", ".git", "dist", "build", "__pycache__", "venv", ".venv", "coverage", ".next", ".nuxt"].includes(
      segment
    )
  );
}

export function isScannablePromptFile(path: string): boolean {
  return /\.(js|jsx|ts|tsx|py|md|mdx)$/i.test(path);
}
