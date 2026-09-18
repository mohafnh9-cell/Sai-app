import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { normalizeStoredGitHubRepository } from "@/lib/github/repository-reference";
import { resolveSafePath, WorkspaceBoundaryError } from "./workspace";

/**
 * L1.2 -- replaces the fixed LOCAL_PROJECT_ID/LOCAL_REPOSITORY_ID/
 * LOCAL_ORGANIZATION_ID placeholders with real identity, WITHOUT trusting
 * anything on the local filesystem as authorization. Everything in this
 * file is an IDENTIFIER, never a credential:
 *
 *   LOCAL FILE != AUTHORITY
 *
 * A malicious repository could ship a .sequrai/project.json claiming
 * projectId="victim-project" -- resolveLocalIdentity() never treats that
 * claim as binding on its own. Cloud binding only happens through
 * resolveCloudBinding (STEP 6), which must be handed an already-
 * authenticated org-scoped resolver -- see that function's doc comment for
 * exactly what is and isn't implemented in this phase.
 */

const PROJECT_FILE_RELATIVE_PATH = ".sequrai/project.json";
const MAX_PROJECT_FILE_BYTES = 4096;

export type LocalRepositoryIdentity = {
  /**
   * Canonical GitHub html_url form (e.g. "https://github.com/acme/app"),
   * exactly matching the format already stored in projects.github_repo --
   * reuses lib/github/repository-reference.ts's own canonicalization
   * rather than a second parser. Null when the remote isn't a GitHub
   * repository (or there's no remote at all).
   */
  githubRepo: string | null;
  /**
   * Stable across clones/worktrees of the SAME remote, distinct for
   * different remotes: sha256 of the canonical githubRepo when one exists,
   * otherwise of the raw (trimmed) remote URL text, otherwise a fixed
   * "no-remote" sentinel -- never random, so this never causes two
   * worktrees of the same non-GitHub repo to appear unrelated.
   */
  repositoryId: string;
};

export type LocalWorkspaceIdentity = {
  /** Stable per real (symlink-resolved) absolute path -- two worktrees of the same repo get different workspaceIds; the same worktree always gets the same one. */
  workspaceId: string;
  repository: LocalRepositoryIdentity;
};

export type LocalProjectFile = {
  version: 1;
  /** A local-only UUID -- NEVER a claim of cloud project ownership, see the module doc comment. */
  projectId: string;
  repositoryId: string;
  createdAt: string;
  repository: { remote: string | null };
};

export type LocalProjectBinding =
  | {
      mode: "local-only";
      projectId: string;
      repositoryId: string;
      workspaceId: string;
    }
  | {
      mode: "cloud-bound";
      /** The real, server-verified SequrAI project id -- not the local project.json's projectId. */
      projectId: string;
      organizationId: string;
      projectName: string;
      repositoryId: string;
      workspaceId: string;
    };

/** SSH URLs come in two forms git actually produces; parseGitHubRepository only understands the scp-like one. Pre-normalize the explicit-scheme form before handing off, rather than teaching the shared parser a local-only quirk. */
function normalizeSshUrl(value: string): string {
  const match = /^ssh:\/\/git@github\.com\/(.+)$/i.exec(value.trim());
  return match ? `git@github.com:${match[1]}` : value;
}

/**
 * STEP 4: canonical Git repository identity. Reuses
 * lib/github/repository-reference.ts's parser (already handles HTTPS,
 * the git@host: scp-like SSH form, .git suffix, trailing slashes) rather
 * than a second implementation -- only adds the ssh:// explicit-scheme
 * pre-normalization that parser doesn't cover.
 */
export function canonicalRepositoryIdentity(
  remoteUrl: string | null | undefined,
  /** Used only when there's no remote to derive identity from -- see resolveWorkspaceIdentity, which passes the repository's own root commit SHA so two remote-less repositories don't collapse onto one shared identity. */
  noRemoteFallbackSeed?: string | null
): LocalRepositoryIdentity {
  const trimmed = remoteUrl?.trim();
  if (!trimmed) {
    const seed = noRemoteFallbackSeed ? `no-remote:${noRemoteFallbackSeed}` : "no-remote";
    return { githubRepo: null, repositoryId: deterministicUuid(seed) };
  }

  // normalizeStoredGitHubRepository throws (rather than returning null) for
  // a non-github.com host or an unparseable URL -- caught here so a real,
  // non-GitHub remote still gets a stable identity instead of crashing
  // resolution.
  let githubRepo: string | null = null;
  try {
    githubRepo = normalizeStoredGitHubRepository(normalizeSshUrl(trimmed));
  } catch {
    githubRepo = null;
  }
  if (githubRepo) {
    return { githubRepo, repositoryId: deterministicUuid(githubRepo) };
  }
  // Not a github.com remote (or unparseable) -- still a stable, real
  // identity so a non-GitHub repo's worktrees agree with each other; never
  // silently treated as "the same as no remote at all".
  return { githubRepo: null, repositoryId: deterministicUuid(trimmed) };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * generateProductionVerdict()'s schema requires projectId/repositoryId to
 * be UUID-shaped (see ProductionVerdictSchema) -- a raw sha256 hex string
 * fails that validation. Deterministically reshapes the first 16 bytes of
 * a sha256 digest into a valid (version 5, variant 10) UUID string: same
 * determinism guarantee as a plain hash (same input -> same id, always),
 * just wearing the byte layout the schema expects. Not RFC 4122 UUIDv5
 * (which additionally requires a namespace UUID + its specific
 * construction) -- interoperability with other UUIDv5 generators is not a
 * requirement here, only a stable, schema-valid identifier.
 */
function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function readGitRemote(workspaceRoot: string): string | null {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

/** The repository's own root commit -- stable across clones/worktrees of the same history, unlike a workspace path. Used only as the identity fallback when there's no remote (scenario D: multiple remote-less repositories must not collapse onto one shared "no-remote" identity). */
function readGitRootCommit(workspaceRoot: string): string | null {
  try {
    return (
      execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split("\n")[0] || null
    );
  } catch {
    return null;
  }
}

/**
 * STEP 8: repository identity != workspace identity. Two worktrees of the
 * same repo share `repository.repositoryId` but get distinct
 * `workspaceId`s, derived from the REAL (symlink-resolved) absolute path
 * so a symlinked alias of the same worktree doesn't appear to be a third,
 * different workspace.
 */
export function resolveWorkspaceIdentity(workspaceRoot: string): LocalWorkspaceIdentity {
  const realPath = realpathSync.native(workspaceRoot);
  const remote = readGitRemote(workspaceRoot);
  const fallbackSeed = remote ? null : readGitRootCommit(workspaceRoot);
  return {
    workspaceId: sha256(realPath),
    repository: canonicalRepositoryIdentity(remote, fallbackSeed),
  };
}

/**
 * STEP 13: reads .sequrai/project.json only through the existing workspace
 * boundary (resolveSafePath already rejects traversal/symlink escape), with
 * its own size cap and shape validation. Never executes anything from the
 * file -- it's parsed as inert JSON and validated field-by-field. Returns
 * null (not a throw) for missing/malformed content -- a malformed file is
 * `regenerated silently by the caller, never a crash and never trusted
 * partially.
 */
export function readLocalProjectFile(workspaceRoot: string): LocalProjectFile | null {
  let target: string;
  try {
    target = resolveSafePath(workspaceRoot, PROJECT_FILE_RELATIVE_PATH);
  } catch (error) {
    if (error instanceof WorkspaceBoundaryError || (error as Error).message === "symlink_not_allowed") {
      return null;
    }
    throw error;
  }

  if (!existsSync(target)) return null;

  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch {
    return null;
  }
  if (raw.length > MAX_PROJECT_FILE_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return validateProjectFileShape(parsed) ? parsed : null;
}

function validateProjectFileShape(value: unknown): value is LocalProjectFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.projectId !== "string" || !UUID_PATTERN.test(v.projectId)) return false;
  if (typeof v.repositoryId !== "string" || !UUID_PATTERN.test(v.repositoryId)) return false;
  if (typeof v.createdAt !== "string") return false;
  if (!v.repository || typeof v.repository !== "object") return false;
  const repo = v.repository as Record<string, unknown>;
  if (repo.remote !== null && typeof repo.remote !== "string") return false;
  // Reject any unexpected field rather than silently ignoring it -- a
  // forged project.json with extra fields (e.g. an embedded
  // organizationId/apiKey claim) is treated as malformed, not partially
  // trusted (STEP 12).
  const allowedTopKeys = new Set(["version", "projectId", "repositoryId", "createdAt", "repository"]);
  const allowedRepoKeys = new Set(["remote"]);
  if (Object.keys(v).some((k) => !allowedTopKeys.has(k))) return false;
  if (Object.keys(repo).some((k) => !allowedRepoKeys.has(k))) return false;
  return true;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads .sequrai/project.json if valid, otherwise writes a fresh one.
 * The file is deliberately safe to commit -- it carries a local-only UUID
 * (never a secret), the canonical GitHub repo string, and a timestamp; see
 * the module/type doc comments for why this is never treated as an
 * authorization claim by itself.
 */
export function ensureLocalProjectFile(workspaceRoot: string, repository: LocalRepositoryIdentity): LocalProjectFile {
  const existing = readLocalProjectFile(workspaceRoot);
  if (existing && existing.repositoryId === repository.repositoryId) {
    return existing;
  }

  const file: LocalProjectFile = {
    version: 1,
    projectId: randomUUID(),
    repositoryId: repository.repositoryId,
    createdAt: new Date().toISOString(),
    repository: { remote: repository.githubRepo },
  };

  try {
    const target = resolveSafePath(workspaceRoot, PROJECT_FILE_RELATIVE_PATH);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o644 });
  } catch {
    // Filesystem may be read-only or the boundary rejected the write --
    // the identity still works in-memory for this run; it just won't
    // persist across sessions. Never throw here: a scan must not fail
    // merely because it couldn't write a convenience file.
  }

  return file;
}

/**
 * STEP 6/10: the ONLY function in this module that may claim cloud
 * ownership -- and it does so by requiring the caller to hand it an
 * already-authenticated, already-org-scoped resolver rather than by
 * reading anything local. `resolve` is expected to be
 * server/mcp/project-resolution.ts's resolveMcpProject (or an equivalent
 * that, like it, derives organizationId from a verified McpAuthContext,
 * never from a parameter this function could be tricked into passing
 * along) -- reused, not reimplemented, so there is exactly one place that
 * decides "does this org own this repository."
 *
 * Not wired to a live network transport in this phase: the stdio bridge
 * (where local-analysis actually runs) has no direct database access and
 * calling resolveMcpProject requires one; exposing it over the network
 * needs a new MCP tool (definition + execute-tool wiring + scope + tests),
 * which is explicitly out of L1.2's scope (STEP 18/19 -- no new MCP
 * surface this phase). This function is the real, secure, ready-to-call
 * resolver; the transport to reach it from the bridge is deferred and
 * reported as such, not silently skipped.
 */
export async function resolveCloudBinding(
  githubRepo: string,
  resolve: (repositoryFullName: string) => Promise<{ projectId: string; organizationId: string; projectName: string } | null>
): Promise<{ projectId: string; organizationId: string; projectName: string } | null> {
  return resolve(githubRepo);
}

/**
 * The main entry point. Local-only by default -- never touches the
 * network unless `cloudResolver` is explicitly supplied, so a purely local
 * scan (STEP 5) never requires cloud authorization. When a resolver IS
 * supplied and the workspace has a GitHub remote, its answer is
 * authoritative: a "not found/not yours" response always wins over
 * anything in .sequrai/project.json (STEP 12 -- a forged local file can
 * name any projectId it wants; only the resolver's own org-scoped answer
 * can produce a "cloud-bound" result).
 */
export async function resolveLocalIdentity(
  workspaceRoot: string,
  cloudResolver?: (repositoryFullName: string) => Promise<{ projectId: string; organizationId: string; projectName: string } | null>
): Promise<LocalProjectBinding> {
  const { workspaceId, repository } = resolveWorkspaceIdentity(workspaceRoot);
  const projectFile = ensureLocalProjectFile(workspaceRoot, repository);

  if (cloudResolver && repository.githubRepo) {
    const bound = await resolveCloudBinding(repository.githubRepo, cloudResolver);
    if (bound) {
      return {
        mode: "cloud-bound",
        projectId: bound.projectId,
        organizationId: bound.organizationId,
        projectName: bound.projectName,
        repositoryId: repository.repositoryId,
        workspaceId,
      };
    }
  }

  return {
    mode: "local-only",
    projectId: projectFile.projectId,
    repositoryId: repository.repositoryId,
    workspaceId,
  };
}
