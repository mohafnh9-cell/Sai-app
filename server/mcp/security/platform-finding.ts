import type { Finding, FindingDraft, FindingLocation } from "@/features/security-scanner/types";
import type { UntrustedContentSource } from "./delimiters";
import type { InjectionPatternMatch } from "./input-guard";

export const PLATFORM_INJECTION_RULE_ID = "platform.prompt_injection_attempt";
export const PLATFORM_INJECTION_CATEGORY = "prompt_injection_attempt";
export const PLATFORM_INJECTION_SOURCE_TOOL = "platform_input_guard" as const;

export type PlatformInjectionDetection = InjectionPatternMatch & {
  source: UntrustedContentSource;
  path?: string | null;
};

function locationForDetection(detection: PlatformInjectionDetection): FindingLocation {
  const path =
    detection.path ??
    (detection.source === "dependency_metadata"
      ? "dependency-metadata"
      : detection.source === "commit_history"
        ? "commit-history"
        : "platform-untrusted-input");
  return { path, line: detection.line ?? 1 };
}

export function platformInjectionToFindingDraft(
  detection: PlatformInjectionDetection
): FindingDraft {
  const location = locationForDetection(detection);
  return {
    ruleId: `${PLATFORM_INJECTION_RULE_ID}.${detection.ruleId}`,
    title: "Prompt injection attempt detected in repository content",
    description: [
      "SequrAI detected instruction-override patterns in untrusted repository content while preparing analysis.",
      "This content was isolated and treated as data — it cannot change verdict confidence or Safe Fix instructions.",
      "",
      detection.message,
    ].join("\n"),
    severity: detection.action === "BLOCK" ? "high" : "medium",
    confidence: "low",
    category: PLATFORM_INJECTION_CATEGORY,
    location,
    evidence: detection.matchedText,
    remediation:
      "Review the flagged file or metadata for hostile instructions embedded in comments, README text, commit messages, or dependency descriptions. Remove or rewrite the content so it cannot influence downstream AI analysis.",
    metadata: {
      platformInjectionGuard: {
        source: detection.source,
        path: detection.path ?? null,
        ruleId: detection.ruleId,
        action: detection.action,
        patternCategory: detection.category,
      },
    },
  };
}

export function platformInjectionFingerprintMaterial(
  detection: PlatformInjectionDetection
): string {
  return [
    PLATFORM_INJECTION_RULE_ID,
    detection.source,
    detection.path ?? "",
    detection.ruleId,
    detection.matchedText.slice(0, 120),
  ].join("|");
}

export function isPlatformInjectionFinding(finding: Pick<Finding, "category" | "ruleId">): boolean {
  return (
    finding.category === PLATFORM_INJECTION_CATEGORY ||
    finding.ruleId.startsWith(`${PLATFORM_INJECTION_RULE_ID}.`)
  );
}
