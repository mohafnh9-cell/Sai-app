import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LocalAnalysisScope } from "./constants";
import type { LocalGitContext } from "./types";
import { normalizeWorkspaceRoot } from "./workspace";

function runGit(workspaceRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function getGitContext(workspaceRoot: string): LocalGitContext {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const insideGit = existsSync(join(root, ".git"));
  if (!insideGit) {
    return {
      isGitRepository: false,
      branch: null,
      commitSha: null,
      status: null,
      diff: null,
      stagedDiff: null,
    };
  }

  return {
    isGitRepository: true,
    branch: runGit(root, ["branch", "--show-current"]),
    commitSha: runGit(root, ["rev-parse", "HEAD"]),
    status: runGit(root, ["status", "--porcelain"]),
    diff: runGit(root, ["diff"]),
    stagedDiff: runGit(root, ["diff", "--cached"]),
  };
}

export function parseChangedFilesFromStatus(status: string | null): string[] {
  if (!status) return [];
  const files = new Set<string>();
  for (const line of status.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const raw = line.slice(3).trim();
    if (!raw) continue;
    const path = raw.includes(" -> ") ? raw.split(" -> ").pop()!.trim() : raw;
    files.add(path.replace(/\\/g, "/"));
  }
  return [...files];
}

export function parseGitFileCounts(status: string | null): {
  modifiedFiles: number;
  untrackedFiles: number;
  deletedFiles: number;
} {
  if (!status) {
    return { modifiedFiles: 0, untrackedFiles: 0, deletedFiles: 0 };
  }

  let modifiedFiles = 0;
  let untrackedFiles = 0;
  let deletedFiles = 0;

  for (const line of status.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const indexCode = line.slice(0, 2);
    if (indexCode.includes("?")) {
      untrackedFiles += 1;
      continue;
    }
    if (indexCode.includes("D")) {
      deletedFiles += 1;
    }
    if (/M|A|R|C|T|U/.test(indexCode)) {
      modifiedFiles += 1;
    }
  }

  return { modifiedFiles, untrackedFiles, deletedFiles };
}

export function parseChangedFilesFromDiff(diff: string | null): string[] {
  if (!diff) return [];
  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      const path = line.slice(6).trim();
      if (path !== "/dev/null") {
        files.add(path);
      }
    }
  }
  return [...files];
}

export function resolveScopePaths(
  git: LocalGitContext,
  scope: LocalAnalysisScope
): { scope: LocalAnalysisScope; paths: Set<string>; requiresGit: boolean } {
  if (!git.isGitRepository) {
    if (scope === "workspace") {
      return { scope, paths: new Set(), requiresGit: false };
    }
    return { scope, paths: new Set(), requiresGit: true };
  }

  if (scope === "workspace") {
    return { scope, paths: new Set(), requiresGit: false };
  }

  if (scope === "staged") {
    const paths = new Set(parseChangedFilesFromDiff(git.stagedDiff));
    return { scope, paths, requiresGit: false };
  }

  if (scope === "diff") {
    const paths = new Set(parseChangedFilesFromDiff(git.diff));
    return { scope, paths, requiresGit: false };
  }

  const paths = new Set([
    ...parseChangedFilesFromStatus(git.status),
    ...parseChangedFilesFromDiff(git.diff),
    ...parseChangedFilesFromDiff(git.stagedDiff),
  ]);
  return { scope: "working_tree", paths, requiresGit: false };
}

export function resolveScopeFromArgs(input: {
  scope?: LocalAnalysisScope;
  gitDiffOnly?: boolean;
}): LocalAnalysisScope {
  if (input.gitDiffOnly) return "diff";
  return input.scope ?? "workspace";
}
