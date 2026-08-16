import { generateProductionVerdict, verdictHeadline } from "@/brain/production-verdict/engine";
import { scanRepository } from "@/features/security-scanner/scanner";
import {
  createLocalScanId,
  LOCAL_PROJECT_ID,
  LOCAL_REPOSITORY_ID,
  type LocalAnalysisScope,
} from "./constants";
import {
  getGitContext,
  parseGitFileCounts,
  resolveScopeFromArgs,
  resolveScopePaths,
} from "./git-scope";
import {
  collectInputFiles,
  mapFindingToPublic,
  mapFindingsToPublic,
  mapScanFindingToVerdictInput,
} from "./map-findings";
import type {
  LocalGitMetadata,
  LocalProductionVerdictResult,
  LocalSnapshotMetadata,
  RunLocalVerdictInput,
} from "./types";
import { buildLocalStatusSummary } from "./format-local-response";
import { listWorkspaceFiles, normalizeWorkspaceRoot } from "./workspace";

function buildGitMetadata(git: ReturnType<typeof getGitContext>): LocalGitMetadata {
  const counts = parseGitFileCounts(git.status);
  return {
    branch: git.branch,
    commitSha: git.commitSha,
    modifiedFiles: counts.modifiedFiles,
    untrackedFiles: counts.untrackedFiles,
    deletedFiles: counts.deletedFiles,
  };
}

function buildInsufficientDataResult(input: {
  workspace: string;
  scope: LocalAnalysisScope;
  git: ReturnType<typeof getGitContext>;
  snapshot: LocalSnapshotMetadata;
  reason: string;
}): LocalProductionVerdictResult {
  const scanId = createLocalScanId();
  const { verdict } = generateProductionVerdict({
    projectId: LOCAL_PROJECT_ID,
    repositoryId: LOCAL_REPOSITORY_ID,
    scanId,
    commitSha: input.git.commitSha,
    branch: input.git.branch,
    scanStatus: "completed",
    securityScore: null,
    filesAnalyzed: 0,
    filesDiscovered: input.snapshot.filesAnalyzed,
    findings: [],
    partialScanFailure: input.snapshot.truncated,
  });

  return {
    source: "local",
    gitAvailable: input.git.isGitRepository,
    scope: input.scope,
    phase: input.snapshot.truncated ? "partial" : "complete",
    workspace: input.workspace,
    branch: input.git.branch,
    commitSha: input.git.commitSha,
    verdictStatus: verdict.status,
    score: verdict.score,
    blockersCount: verdict.blockersCount,
    findings: [],
    productionVerdict: verdict as unknown as Record<string, unknown>,
    snapshot: input.snapshot,
    git: buildGitMetadata(input.git),
    scanMetrics: {
      inputFiles: 0,
      scannedFiles: 0,
      rulesRun: 0,
      truncated: input.snapshot.truncated,
    },
    narrative: buildLocalStatusSummary({
      scope: input.scope,
      verdictStatus: verdict.status,
      score: verdict.score,
      findings: [],
      reason: input.reason,
    }),
    methodologyNote: verdict.methodologyNote,
  };
}

export async function runLocalProductionVerdict(
  input: RunLocalVerdictInput = {}
): Promise<LocalProductionVerdictResult> {
  const workspace = normalizeWorkspaceRoot(input.workspacePath ?? process.cwd());
  const scope = resolveScopeFromArgs(input);
  const git = getGitContext(workspace);
  const listing = listWorkspaceFiles(workspace);
  const emptySnapshot: LocalSnapshotMetadata = {
    filesAnalyzed: 0,
    filesExcluded: listing.stats.filesExcluded,
    bytesAnalyzed: 0,
    truncated: listing.truncated,
    credentialsSkipped: listing.stats.credentialsSkipped,
  };

  const { scope: resolvedScope, paths, requiresGit } = resolveScopePaths(git, scope);

  if (requiresGit) {
    return buildInsufficientDataResult({
      workspace,
      scope,
      git,
      snapshot: emptySnapshot,
      reason:
        "Git is not available in this workspace. Use scope=workspace or initialize a git repository.",
    });
  }

  if (resolvedScope !== "workspace" && paths.size === 0) {
    return buildInsufficientDataResult({
      workspace,
      scope: resolvedScope,
      git,
      snapshot: emptySnapshot,
      reason: "No changed files detected for the selected scope.",
    });
  }

  const scopedListing =
    resolvedScope === "workspace"
      ? listing
      : listWorkspaceFiles(workspace, { onlyRelativePaths: paths });

  const inputFiles = collectInputFiles(
    workspace,
    resolvedScope === "workspace" ? undefined : paths
  );

  if (inputFiles.length === 0) {
    return buildInsufficientDataResult({
      workspace,
      scope: resolvedScope,
      git,
      snapshot: {
        filesAnalyzed: 0,
        filesExcluded: scopedListing.stats.filesExcluded,
        bytesAnalyzed: 0,
        truncated: scopedListing.truncated,
        credentialsSkipped: scopedListing.stats.credentialsSkipped,
      },
      reason: "No readable source files found inside the authorized workspace.",
    });
  }

  const scan = await scanRepository(inputFiles);
  const scanId = createLocalScanId();
  const bytesAnalyzed = inputFiles.reduce((sum, file) => sum + file.content.length, 0);
  const snapshotTruncated = scopedListing.truncated || scan.metrics.truncated;
  const snapshot: LocalSnapshotMetadata = {
    filesAnalyzed: scan.metrics.scannedFiles,
    filesExcluded: scopedListing.stats.filesExcluded,
    bytesAnalyzed,
    truncated: snapshotTruncated,
    credentialsSkipped: scopedListing.stats.credentialsSkipped,
  };

  const { verdict } = generateProductionVerdict({
    projectId: LOCAL_PROJECT_ID,
    repositoryId: LOCAL_REPOSITORY_ID,
    scanId,
    commitSha: git.commitSha,
    branch: git.branch,
    scanStatus: "completed",
    securityScore: scan.score.score,
    filesAnalyzed: scan.metrics.scannedFiles,
    filesDiscovered: scopedListing.stats.discoveredFiles,
    findings: scan.findings.map(mapScanFindingToVerdictInput),
    partialScanFailure: snapshotTruncated,
  });

  const publicFindings = mapFindingsToPublic(scan.findings);
  const actionableFindings = publicFindings.filter((finding) => !finding.safeToIgnore);

  return {
    source: "local",
    gitAvailable: git.isGitRepository,
    scope: resolvedScope,
    phase: snapshotTruncated ? "partial" : "complete",
    workspace,
    branch: git.branch,
    commitSha: git.commitSha,
    verdictStatus: verdict.status,
    score: verdict.score,
    blockersCount: verdict.blockersCount,
    findings: publicFindings,
    productionVerdict: verdict as unknown as Record<string, unknown>,
    snapshot,
    git: buildGitMetadata(git),
    scanMetrics: {
      inputFiles: scan.metrics.inputFiles,
      scannedFiles: scan.metrics.scannedFiles,
      rulesRun: scan.metrics.rulesRun,
      truncated: snapshotTruncated,
    },
    narrative: buildLocalStatusSummary({
      scope: resolvedScope,
      verdictStatus: verdict.status,
      score: verdict.score,
      findings: actionableFindings,
      headline: verdictHeadline(verdict.status),
      executiveSummary: verdict.executiveSummary,
      topPriorities: verdict.topPriorities.map((priority) => priority.title),
    }),
    methodologyNote: verdict.methodologyNote,
    correlation: {
      ready: Boolean(git.commitSha),
      commitSha: git.commitSha,
      branch: git.branch,
      reason: git.commitSha
        ? undefined
        : "Local analysis has no verified commit SHA for GitHub correlation.",
    },
  };
}

export function buildLocalWorkspaceStatus(workspacePath?: string) {
  const workspace = normalizeWorkspaceRoot(workspacePath ?? process.cwd());
  const listing = listWorkspaceFiles(workspace);
  const git = getGitContext(workspace);
  const gitMeta = buildGitMetadata(git);
  return {
    source: "local" as const,
    gitAvailable: git.isGitRepository,
    workspace,
    branch: git.branch,
    commitSha: git.commitSha,
    isGitRepository: git.isGitRepository,
    gitStatus: git.status,
    git: gitMeta,
    snapshot: {
      filesAnalyzed: listing.files.length,
      filesExcluded: listing.stats.filesExcluded,
      bytesAnalyzed: listing.totalBytes,
      truncated: listing.truncated,
      credentialsSkipped: listing.stats.credentialsSkipped,
    },
    filesCount: listing.files.length,
    totalBytes: listing.totalBytes,
    truncated: listing.truncated,
    analysisReadiness: listing.files.length > 0 ? "ready" : "empty",
    ignoredExamples: ["node_modules/", ".git/", ".env (credentials skipped)"],
  };
}

export function buildLocalReview(input: { workspacePath?: string; gitDiffOnly?: boolean }) {
  const workspace = normalizeWorkspaceRoot(input.workspacePath ?? process.cwd());
  const git = getGitContext(workspace);
  const scope = input.gitDiffOnly ? "diff" : "working_tree";
  const diff = input.gitDiffOnly
    ? git.diff
    : `${git.stagedDiff ?? ""}\n${git.diff ?? ""}`.trim();

  return {
    source: "local" as const,
    gitAvailable: git.isGitRepository,
    scope,
    branch: git.branch,
    git: buildGitMetadata(git),
    hasChanges: Boolean(git.status?.trim()),
    diffPreview: diff ? diff.slice(0, 4000) : null,
    message: git.status?.trim()
      ? "Local changes detected. Use sequrai_local_audit or audit_local_project with scope working_tree, staged, or diff."
      : "No local changes detected.",
  };
}

export function buildLocalFindings(workspacePath?: string) {
  return runLocalProductionVerdict({ workspacePath, scope: "workspace" }).then((result) => ({
    source: "local" as const,
    scope: "workspace" as const,
    findings: result.findings.filter(
      (finding) =>
        finding.severity === "critical" ||
        finding.severity === "high" ||
        !finding.safeToIgnore
    ),
  }));
}

export async function buildLocalPrepareManifest(workspacePath?: string) {
  const workspace = normalizeWorkspaceRoot(workspacePath ?? process.cwd());
  const listing = listWorkspaceFiles(workspace);
  return {
    source: "local" as const,
    workspace,
    files: listing.files.map((file) => ({
      path: file.relativePath,
      size: file.size,
    })),
    snapshot: {
      filesAnalyzed: listing.files.length,
      filesExcluded: listing.stats.filesExcluded,
      bytesAnalyzed: listing.totalBytes,
      truncated: listing.truncated,
      credentialsSkipped: listing.stats.credentialsSkipped,
    },
    totalBytes: listing.totalBytes,
    truncated: listing.truncated,
    redaction: "credentials_excluded_at_walk_time",
    note: "Manifest only. Remote analysis requires explicit user action.",
  };
}
