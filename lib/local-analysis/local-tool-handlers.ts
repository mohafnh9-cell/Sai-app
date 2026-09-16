import type { LocalToolArgs } from "./types";
import {
  buildLocalFindings,
  buildLocalFix,
  buildLocalPrepareManifest,
  buildLocalReview,
  buildLocalWorkspaceStatus,
  runLocalProductionVerdict,
} from "./run-local-verdict";
import { resolveScopeFromArgs } from "./git-scope";
import { resolveAuthorizedWorkspacePath, WorkspaceBoundaryError } from "./workspace";

export const LOCAL_TOOL_NAMES = [
  "sequrai_local_status",
  "sequrai_local_audit",
  "audit_local_project",
  "sequrai_local_review",
  "sequrai_local_findings",
  "sequrai_local_prepare",
  "sequrai_local_fix",
] as const;

export const LOCAL_AUDIT_TOOL_NAMES = ["sequrai_local_audit", "audit_local_project"] as const;

export function isLocalToolName(name: string): boolean {
  return (LOCAL_TOOL_NAMES as readonly string[]).includes(name);
}

export function isLocalAuditToolName(name: string): boolean {
  return (LOCAL_AUDIT_TOOL_NAMES as readonly string[]).includes(name);
}

function resolveLocalWorkspacePath(args: LocalToolArgs): string {
  const authorizedRoot = process.env.SEQURAI_WORKSPACE_ROOT ?? process.cwd();
  return resolveAuthorizedWorkspacePath(authorizedRoot, args.workspacePath);
}

export async function executeLocalTool(name: string, args: LocalToolArgs = {}) {
  let workspacePath: string;
  try {
    workspacePath = resolveLocalWorkspacePath(args);
  } catch (error) {
    if (error instanceof WorkspaceBoundaryError) {
      throw error;
    }
    throw error;
  }

  if (isLocalAuditToolName(name)) {
    // L1.6: persist=true -- this tool runs a genuine fresh scan, and
    // remembering it is what makes sequrai_local_findings/status able to
    // report NEW/PERSISTING/RESOLVED history at all.
    return runLocalProductionVerdict({
      workspacePath,
      scope: resolveScopeFromArgs(args),
      gitDiffOnly: args.gitDiffOnly,
      persist: true,
    });
  }

  switch (name) {
    case "sequrai_local_status":
      return buildLocalWorkspaceStatus(workspacePath);
    case "sequrai_local_review":
      return buildLocalReview({ workspacePath, gitDiffOnly: args.gitDiffOnly });
    case "sequrai_local_findings":
      return buildLocalFindings(workspacePath);
    case "sequrai_local_prepare":
      return buildLocalPrepareManifest(workspacePath);
    case "sequrai_local_fix":
      return buildLocalFix(workspacePath, args.correlationKey);
    default:
      throw new Error(`unknown_local_tool:${name}`);
  }
}

export { runLocalProductionVerdict } from "./run-local-verdict";
