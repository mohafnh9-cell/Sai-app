export {
  AGENT_SECURITY_SCANNER_ID,
  AGENT_SECURITY_SCANNER_VERSION,
  EXTERNAL_SECURITY_SOURCE_TOOLS,
  type ExternalSecuritySourceTool,
} from "./constants";

export {
  securityAnalysisFindingSchema,
  type SecurityAnalysisFinding,
  type RawExternalFinding,
  type ExternalSeverity,
  type ExternalConfidence,
  type AgentAction,
  isExternalSecuritySourceTool,
} from "./schema";

export { deriveInitialVerificationStatus } from "./derive-verification-status";

export {
  normalizeExternalFinding,
  normalizeExternalFindings,
  type NormalizeExternalFindingOptions,
} from "./normalize-external-finding";

export {
  securityAnalysisFindingToDraft,
  securityAnalysisFindingsToDrafts,
} from "./to-finding-draft";

export {
  externalFindingToDraft,
  externalFindingsToDrafts,
  externalFindingsToSecurityAnalysis,
  mergeExternalFindingDrafts,
} from "./integrate-scan-findings";

export {
  buildSbomSnapshot,
  discoverComponentsFromFiles,
  parseLockfile,
} from "./sbom/lockfile-parsers";
export type { RepositoryFile, SbomComponent, SbomSnapshot } from "./sbom/types";

export {
  queryOsvBatch,
  componentsToOsvPackages,
  createOsvMemoryCache,
  packageIdentityKey,
} from "./osv/client";
export {
  analyzeOsvSbomEvidence,
  dedupeOsvFindings,
  osvBatchToFindings,
  osvVulnerabilityToFinding,
  OSV_SBOM_EXTERNAL_RULE_ID,
  OSV_SBOM_RULE_ID,
} from "./osv/enrich-sbom";
export type { OsvSbomAnalysisOptions, OsvSbomAnalysisResult } from "./osv/enrich-sbom";
export {
  mapOsvConfidence,
  mapOsvExternalSeverity,
  mapOsvVulnerability,
} from "./osv/map-vulnerability";
export type {
  OsvApiVulnerability,
  OsvBatchResult,
  OsvMappedVulnerability,
  OsvQueryPackage,
} from "./osv/types";
export { OsvQueryError } from "./osv/types";

export { osvSbomRule, repositoryFilesToOsvDrafts } from "./rules/osv-sbom-rule";

export {
  analyzeMcpSecurity,
  mcpSecurityRule,
  repositoryFilesToMcpDrafts,
} from "./rules/mcp-security-rule";
export { scanMcpRepository } from "./mcp/scan-repository";
export { discoverMcpTargets } from "./mcp/discover";
export {
  mcpRawFindingToSecurityAnalysis,
  mcpRawFindingsToSecurityAnalysis,
} from "./mcp/to-findings";
export type { McpRawFinding, McpScanResult } from "./mcp/types";
export { MCP_SECURITY_RULE_ID } from "./mcp/constants";

export {
  analyzePromptInjectionSecurity,
  promptInjectionRule,
  repositoryFilesToPromptInjectionDrafts,
} from "./rules/prompt-injection-rule";
export { scanPromptInjectionRepository } from "./prompt-injection/scan-repository";
export {
  promptRawFindingToSecurityAnalysis,
  promptRawFindingsToSecurityAnalysis,
} from "./prompt-injection/to-findings";
export type { PromptInjectionTier, PromptRawFinding, PromptScanResult } from "./prompt-injection/types";
export { PROMPT_INJECTION_RULE_ID } from "./prompt-injection/constants";

export {
  analyzeAgentActionSecurity,
  agentActionRule,
  repositoryFilesToAgentActionDrafts,
} from "./rules/agent-action-rule";
export { scanAgentActionRepository } from "./agent-action/scan-repository";
export {
  agentActionRawFindingToSecurityAnalysis,
  agentActionRawFindingsToSecurityAnalysis,
} from "./agent-action/to-findings";
export type { AgentActionRawFinding, AgentScanResult } from "./agent-action/types";
export { AGENT_ACTION_RULE_ID } from "./agent-action/constants";

export {
  analyzePackageSecurityEvidence,
  packageSecurityRule,
  repositoryFilesToPackageSecurityDrafts,
} from "./rules/package-security-rule";
export { analyzePackageSecurity } from "./package-security/analyze";
export {
  packageSecurityRawFindingToSecurityAnalysis,
  packageSecurityRawFindingsToSecurityAnalysis,
} from "./package-security/to-findings";
export type {
  DeclaredPackageDependency,
  PackageSecurityRawFinding,
  PackageSecurityScanResult,
} from "./package-security/types";
export { PACKAGE_SECURITY_RULE_ID } from "./package-security/constants";

export {
  enrichSecurityFindingsWithDiffContext,
  enrichFindingDraftsWithDiffContext,
  enrichFindingsWithDiffContext,
} from "./git-diff/enrich-findings";
export { parseUnifiedDiff, buildParsedDiffFromChangedPaths } from "./git-diff/parse-unified-diff";
export { classifyFindingDiffRelationship } from "./git-diff/classify-relationship";
export type {
  DiffContext,
  DiffInput,
  DiffRelationshipStatus,
  ParsedDiff,
  DiffEnrichmentResult,
} from "./git-diff/types";
export { createScanSharedContext, toRepositoryFiles } from "./shared/scan-context";
export type { ScanSharedContext } from "./shared/scan-context";
export { SCAN_SKIP_DIR_SEGMENTS, shouldSkipScanPath } from "./shared/constants";
