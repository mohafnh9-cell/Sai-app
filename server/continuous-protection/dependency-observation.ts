import "server-only";

import { createHash } from "node:crypto";
import { parseGitHubRepository } from "@/lib/github/repository-service";
import { resolveOrganizationGitHubToken } from "@/server/github-automation/token-resolver";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appendCpEvent } from "./cp-memory-bridge";
import type { ProtectionContext } from "./protection-context";

const LOCKFILE_CANDIDATES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const;

function compositeLockfileHash(parts: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

async function fetchLockfileBlobSha(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  const data = (await response.json()) as { sha?: string };
  return data.sha ?? null;
}

export type DependencyObservationResult = {
  lockfileHash: string | null;
  lockfileChanged: boolean;
  newCriticalAdvisory: boolean;
};

/** V1: lockfile blob SHA composite — no full SCA (doc 06 lite). */
export async function runDependencyObservation(
  admin: SupabaseClient,
  ctx: ProtectionContext,
  githubRepo: string | null,
  commitSha: string | null,
  previousLockfileHash: string | null
): Promise<DependencyObservationResult> {
  if (!githubRepo || !commitSha) {
    return { lockfileHash: previousLockfileHash, lockfileChanged: false, newCriticalAdvisory: false };
  }

  const parsed = (() => {
    try {
      return parseGitHubRepository(githubRepo);
    } catch {
      return null;
    }
  })();
  if (!parsed) {
    return { lockfileHash: previousLockfileHash, lockfileChanged: false, newCriticalAdvisory: false };
  }

  const tokenResult = await resolveOrganizationGitHubToken(admin, ctx.organizationId, ctx.projectId);
  if (!tokenResult?.token) {
    return { lockfileHash: previousLockfileHash, lockfileChanged: false, newCriticalAdvisory: false };
  }

  const parts: Record<string, string> = {};
  for (const path of LOCKFILE_CANDIDATES) {
    const sha = await fetchLockfileBlobSha(
      tokenResult.token,
      parsed.owner,
      parsed.repo,
      path,
      commitSha
    );
    if (sha) parts[path] = sha;
  }

  if (Object.keys(parts).length === 0) {
    return { lockfileHash: previousLockfileHash, lockfileChanged: false, newCriticalAdvisory: false };
  }

  const lockfileHash = compositeLockfileHash(parts);
  const lockfileChanged = Boolean(previousLockfileHash && previousLockfileHash !== lockfileHash);
  const firstSeen = !previousLockfileHash;

  if (lockfileChanged || firstSeen) {
    const day = new Date().toISOString().slice(0, 10);
    await appendCpEvent(admin, {
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      type: "dependency_snapshot",
      idempotencyKey: `dependency:${day}:${lockfileHash}`,
      payload: {
        lockfileHash,
        changed: lockfileChanged,
        lockfiles: Object.keys(parts),
        newCriticalAdvisories: [],
      },
    });
  }

  await admin
    .from("project_continuous_protection")
    .update({ lockfile_hash: lockfileHash, updated_at: new Date().toISOString() })
    .eq("project_id", ctx.projectId);

  return {
    lockfileHash,
    lockfileChanged,
    newCriticalAdvisory: false,
  };
}
