import { extractBarePromptRegions } from "./delimiters";
import { scanBarePromptRegionsForInjection, scanInjectionPatterns } from "./input-guard";

export type OutputGuardViolation =
  | { kind: "missing_section"; detail: string }
  | { kind: "injection_in_output"; detail: string; ruleId: string }
  | { kind: "delimiter_escape"; detail: string };

export type OutputGuardResult = {
  ok: boolean;
  prompt: string;
  violations: OutputGuardViolation[];
  sanitizedPrompt: string;
};

const REQUIRED_SAFE_FIX_SECTIONS = [
  "PROJECT CONTEXT",
  "PRODUCTION BLOCKER",
  "SAFE IMPLEMENTATION PRINCIPLES",
  "DO NOT MODIFY",
] as const;

const INSTRUCTION_OVERRIDE_OUTSIDE_DELIMITERS =
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i;

function redactBareInjectionLines(prompt: string): string {
  const lines = prompt.split("\n");
  return lines
    .filter((line) => !INSTRUCTION_OVERRIDE_OUTSIDE_DELIMITERS.test(line))
    .join("\n");
}

function sanitizeBareRegions(prompt: string): string {
  if (!extractBarePromptRegions(prompt).length) {
    return redactBareInjectionLines(prompt);
  }

  let sanitized = "";
  let cursor = 0;
  const startTag = "<<<SEQURAI_UNTRUSTED_REPOSITORY_DATA";
  const endTag = "<<<END_SEQURAI_UNTRUSTED_REPOSITORY_DATA>>>";

  while (cursor < prompt.length) {
    const start = prompt.indexOf(startTag, cursor);
    if (start === -1) {
      sanitized += redactBareInjectionLines(prompt.slice(cursor));
      break;
    }
    sanitized += redactBareInjectionLines(prompt.slice(cursor, start));
    const end = prompt.indexOf(endTag, start);
    if (end === -1) {
      sanitized += prompt.slice(start);
      break;
    }
    sanitized += prompt.slice(start, end + endTag.length);
    cursor = end + endTag.length;
  }

  return sanitized;
}

/**
 * Capa B — validate Safe Fix prompts before they leave SequrAI via MCP or UI.
 * Ensures repository-sourced injection patterns do not appear as bare instructions.
 */
export function guardFixPromptOutput(prompt: string): OutputGuardResult {
  const violations: OutputGuardViolation[] = [];

  for (const section of REQUIRED_SAFE_FIX_SECTIONS) {
    if (!prompt.includes(section)) {
      violations.push({ kind: "missing_section", detail: section });
    }
  }

  const bareRegions = extractBarePromptRegions(prompt);
  for (const region of bareRegions) {
    if (INSTRUCTION_OVERRIDE_OUTSIDE_DELIMITERS.test(region)) {
      violations.push({
        kind: "injection_in_output",
        detail: "Instruction override language outside repository-data delimiters",
        ruleId: "platform.output.instruction-override",
      });
    }

    for (const detection of scanInjectionPatterns(region, {
      source: "finding_field",
      path: "safe-fix-output",
    })) {
      if (detection.action !== "BLOCK") continue;
      violations.push({
        kind: "injection_in_output",
        detail: detection.message,
        ruleId: detection.ruleId,
      });
    }
  }

  if (prompt.includes("<<<SEQURAI_UNTRUSTED_REPOSITORY_DATA") && !prompt.includes("<<<END_SEQURAI_UNTRUSTED_REPOSITORY_DATA>>>")) {
    violations.push({
      kind: "delimiter_escape",
      detail: "Unclosed repository-data delimiter block",
    });
  }

  const sanitizedPrompt = sanitizeBareRegions(prompt);
  return {
    ok: violations.length === 0,
    prompt,
    violations,
    sanitizedPrompt,
  };
}

export function assertFixPromptOutputSafe(prompt: string): string {
  const result = guardFixPromptOutput(prompt);
  if (result.ok) return result.prompt;
  return result.sanitizedPrompt;
}
