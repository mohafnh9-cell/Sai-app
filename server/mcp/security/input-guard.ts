import { PROMPT_CONTENT_RULES } from "@/features/security-analysis/prompt-injection/rules-content";
import {
  extractBarePromptRegions,
  wrapUntrustedRepositoryData,
  type UntrustedContentSource,
} from "./delimiters";
import type { PlatformInjectionDetection } from "./platform-finding";

export type InjectionPatternAction = "BLOCK" | "WARN";

export type InjectionPatternMatch = {
  ruleId: string;
  category: string;
  message: string;
  action: InjectionPatternAction;
  matchedText: string;
  line?: number;
};

export type InputGuardOptions = {
  source: UntrustedContentSource;
  path?: string | null;
  /** When true, wrap even if no pattern matched (for LLM prompt assembly). */
  forceWrap?: boolean;
};

export type InputGuardResult = {
  original: string;
  /** Text safe to embed — wrapped when suspicious or forceWrap. */
  forPrompt: string;
  detections: PlatformInjectionDetection[];
  hadInjectionPattern: boolean;
};

function lineNumberForMatch(content: string, index: number): number {
  return content.slice(0, Math.max(0, index)).split("\n").length;
}

function excerpt(content: string, index: number, length = 120): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(content.length, index + length);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

export function scanInjectionPatterns(
  content: string,
  options: Pick<InputGuardOptions, "source" | "path">
): PlatformInjectionDetection[] {
  if (!content?.trim()) return [];

  const detections: PlatformInjectionDetection[] = [];
  const seen = new Set<string>();

  for (const rule of PROMPT_CONTENT_RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(content);
      if (!match || match.index == null) continue;
      const key = `${rule.id}:${match.index}:${match[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      detections.push({
        ruleId: rule.id,
        category: rule.category,
        message: rule.message,
        action: rule.action === "BLOCK" ? "BLOCK" : "WARN",
        matchedText: excerpt(content, match.index, match[0].length + 40),
        line: lineNumberForMatch(content, match.index),
        source: options.source,
        path: options.path ?? null,
      });
    }
  }

  return detections;
}

/**
 * Capa A — scan untrusted repository content before it enters SequrAI prompts.
 * Uses the same pattern corpus as client prompt-injection analysis (proven heuristics).
 * LLM Guard can replace `scanInjectionPatterns` later via sidecar without changing call sites.
 */
export function guardUntrustedInput(content: string, options: InputGuardOptions): InputGuardResult {
  const original = content ?? "";
  const detections = scanInjectionPatterns(original, options);
  const hadInjectionPattern = detections.some((d) => d.action === "BLOCK") || detections.length > 0;
  const shouldWrap = options.forceWrap === true || hadInjectionPattern;

  const forPrompt = shouldWrap
    ? wrapUntrustedRepositoryData(original, { source: options.source, path: options.path ?? null })
    : original;

  return {
    original,
    forPrompt,
    detections,
    hadInjectionPattern,
  };
}

export function guardUntrustedFields(
  fields: Record<string, string | null | undefined>,
  options: Pick<InputGuardOptions, "source" | "path">
): { fields: Record<string, string>; detections: PlatformInjectionDetection[] } {
  const guarded: Record<string, string> = {};
  const detections: PlatformInjectionDetection[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    const result = guardUntrustedInput(value, { ...options, forceWrap: true });
    guarded[key] = result.forPrompt;
    detections.push(...result.detections);
  }

  return { fields: guarded, detections };
}

export function scanBarePromptRegionsForInjection(prompt: string): PlatformInjectionDetection[] {
  return extractBarePromptRegions(prompt).flatMap((region) =>
    scanInjectionPatterns(region, { source: "finding_field", path: "safe-fix-output" })
  );
}
