export {
  UNTRUSTED_DATA_START,
  UNTRUSTED_DATA_END,
  wrapUntrustedRepositoryData,
  containsUntrustedDelimiter,
  extractBarePromptRegions,
  type UntrustedContentSource,
} from "./delimiters";

export {
  scanInjectionPatterns,
  guardUntrustedInput,
  guardUntrustedFields,
  scanBarePromptRegionsForInjection,
  type InputGuardResult,
  type InjectionPatternMatch,
  type InjectionPatternAction,
} from "./input-guard";

export {
  guardFixPromptOutput,
  assertFixPromptOutputSafe,
  type OutputGuardResult,
  type OutputGuardViolation,
} from "./output-guard";

export {
  PLATFORM_INJECTION_RULE_ID,
  PLATFORM_INJECTION_CATEGORY,
  PLATFORM_INJECTION_SOURCE_TOOL,
  platformInjectionToFindingDraft,
  isPlatformInjectionFinding,
  type PlatformInjectionDetection,
} from "./platform-finding";

export {
  collectPlatformInjectionFindings,
  wrapRepositoryContentForPrompt,
} from "./platform-scan";

export { sanitizeProductionFixPromptInput } from "./safe-fix-input";

export {
  derivePlatformInjectionConfidenceLevel,
  platformInjectionLegacyConfidenceBand,
} from "./platform-confidence";
