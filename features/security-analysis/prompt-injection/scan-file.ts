import { UNTRUSTED_INPUT_INDICATORS } from "./constants";
import {
  adjustConfidence,
  classifyFileContext,
  isCommentLine,
  lineContextKind,
  tierFromContext,
} from "./context";
import { PROMPT_CODE_RULES } from "./rules-code";
import { PROMPT_CONTENT_RULES } from "./rules-content";
import { extractStringLiterals, lineNumberAt, safeRegexMatch, stripComments } from "./text-utils";
import type { FileContext, PromptRawFinding } from "./types";

function extensionForPath(path: string): string {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function hasUntrustedInputNear(content: string, index: number): boolean {
  const window = content.slice(Math.max(0, index - 120), index + 220);
  return UNTRUSTED_INPUT_INDICATORS.test(window);
}

function scanCodeRules(
  path: string,
  content: string,
  context: FileContext
): PromptRawFinding[] {
  const ext = extensionForPath(path);
  const findings: PromptRawFinding[] = [];

  for (const rule of PROMPT_CODE_RULES) {
    if (!rule.fileTypes.includes(ext)) continue;
    if (!context.isLlmRelated && rule.category === "prompt-injection") continue;

    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (rule.requiresUntrustedInput && !hasUntrustedInputNear(content, match.index)) {
        continue;
      }

      const line = lineNumberAt(content, match.index);
      const lineText = content.split("\n")[line - 1] ?? "";
      const lineKind = lineContextKind(lineText, context.kind);
      const tier = tierFromContext(rule.tier, context, lineKind);
      const confidence = adjustConfidence(rule.confidence, context.confidenceMultiplier);

      findings.push({
        rule: rule.id,
        severity: rule.severity,
        category: rule.category,
        message: rule.message,
        file: path,
        line,
        match: match[0].slice(0, 100),
        confidence,
        action: rule.action ?? "WARN",
        tier,
        riskScore: tier === "likely-exploitable" ? 85 : tier === "suspicious-construction" ? 65 : 40,
      });
    }
  }

  return findings;
}

function scanContentRules(
  path: string,
  content: string,
  context: FileContext
): PromptRawFinding[] {
  if (context.suppressContentRules) return [];

  const findings: PromptRawFinding[] = [];
  const candidates = extractStringLiterals(content);
  const executable = stripComments(content);

  for (const candidate of candidates) {
    const candidateLine = content.split("\n")[candidate.line - 1] ?? "";
    if (isCommentLine(candidateLine)) continue;

    const lineKind = lineContextKind(candidateLine, context.kind);
    for (const rule of PROMPT_CONTENT_RULES) {
      for (const pattern of rule.patterns) {
        const match = safeRegexMatch(candidate.text, pattern);
        if (!match) continue;

        const tier = tierFromContext("suspicious-construction", context, lineKind);
        const confidence = adjustConfidence(rule.confidence, context.confidenceMultiplier);

        findings.push({
          rule: rule.id,
          severity: rule.severity,
          category: rule.category,
          message: rule.message,
          file: path,
          line: candidate.line,
          match: match[0].slice(0, 100),
          confidence,
          action: rule.action ?? "WARN",
          tier,
          riskScore: 70,
        });
        break;
      }
    }
  }

  if (context.isLlmRelated) {
    for (const rule of PROMPT_CONTENT_RULES) {
      for (const pattern of rule.patterns) {
        const match = safeRegexMatch(executable, pattern);
        if (!match) continue;
        const index = executable.indexOf(match[0]);
        const line = lineNumberAt(content, index);
        const lineText = content.split("\n")[line - 1] ?? "";
        if (isCommentLine(lineText)) continue;

        const tier = tierFromContext("suspicious-construction", context, lineContextKind(lineText, context.kind));
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          category: rule.category,
          message: rule.message,
          file: path,
          line,
          match: match[0].slice(0, 100),
          confidence: adjustConfidence(rule.confidence, context.confidenceMultiplier),
          action: rule.action ?? "WARN",
          tier,
          riskScore: 60,
        });
        break;
      }
    }
  }

  return findings;
}

export function scanPromptInjectionFile(path: string, content: string): PromptRawFinding[] {
  const context = classifyFileContext(path, content);
  if (context.kind === "documentation" && !context.isLlmRelated) {
    return [];
  }
  if (!context.isLlmRelated && context.kind !== "test" && context.kind !== "fixture") {
    return [];
  }

  return [...scanCodeRules(path, content, context), ...scanContentRules(path, content, context)];
}

export function dedupePromptFindings(findings: PromptRawFinding[]): PromptRawFinding[] {
  const seen = new Set<string>();
  const deduped: PromptRawFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.rule}:${finding.file}:${finding.line}:${finding.match ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

export type { FileContext };
