export {
  LOCAL_TOOL_NAMES,
  executeLocalTool,
  isLocalToolName,
  runLocalProductionVerdict,
} from "./local-tool-handlers";

export {
  resolveSafePath,
  resolveAuthorizedWorkspacePath,
  normalizeWorkspaceRoot,
  isIgnoredRelativePath,
  listWorkspaceFiles,
  readWorkspaceTextFile,
  isBinaryBuffer,
  DEFAULT_IGNORED_DIRS,
  WorkspaceBoundaryError,
} from "./workspace";

export type {
  LocalProductionVerdictResult,
  LocalFindingPublic,
  LocalAnalysisScope,
  LocalSnapshotMetadata,
  LocalGitMetadata,
} from "./types";
export { LOCAL_SCAN_LIMITS } from "./workspace";

export { LocalSafeFixError, type LocalSafeFixResult, type LocalFixCandidate } from "./local-safe-fix";

export {
  recordChangedPath,
  evaluateAutoSecurityTrigger,
  readAutoSecurityState,
  formatAutoSecurityFeedback,
  type AutoSecurityState,
  type AutoSecurityDecision,
} from "./auto-security-trigger";
export { classifySecurityRelevance, type SecurityRelevanceResult } from "./auto-security-classifier";
