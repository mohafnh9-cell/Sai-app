import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchGitHubInstallation } from "./github-api";

export type VerifiedInstallation = {
  githubInstallationId: number;
  accountId: number;
  accountLogin: string;
};

/**
 * Resolves the authenticated SequrAI user's GitHub numeric identity from
 * Supabase's own auth.identities record -- set by Supabase itself, at the
 * moment this user actually authenticated via GitHub OAuth (login or
 * account linking). This requires no GitHub API call, no stored user
 * token, and no new OAuth flow: it's a fact Supabase already verified and
 * already holds.
 *
 * NEVER uses the GitHub login/username (identity_data.user_name) for
 * authorization -- only the immutable numeric provider id.
 */
export async function resolveGitHubProviderId(
  admin: SupabaseClient,
  userId: string
): Promise<number | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;

  const githubIdentity = data.user.identities?.find((identity) => identity.provider === "github");
  const raw = githubIdentity?.identity_data?.provider_id ?? githubIdentity?.identity_data?.sub;
  if (raw === undefined || raw === null) return null;

  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Independently re-verifies a candidate GitHub App installation live
 * against GitHub itself (the App's own JWT -- no user token involved) and
 * against the caller's Supabase-verified numeric GitHub identity. Returns
 * null if ANY check fails, so callers can fail closed uniformly.
 *
 * app_id is not checked separately: GET /app/installations/{id}, signed
 * with THIS app's own JWT, can only ever resolve installations of this
 * same app -- an id belonging to a different GitHub App simply 404s
 * (fetchGitHubInstallation returns null), so that check is inherent to
 * the call itself.
 */
export async function verifyInstallationOwnership(
  githubInstallationId: number,
  providerId: number
): Promise<VerifiedInstallation | null> {
  const remote = await fetchGitHubInstallation(githubInstallationId);
  if (!remote) return null;
  if (remote.suspended_at) return null;
  if (remote.account.type !== "User") return null;
  if (remote.account.id !== providerId) return null;

  return {
    githubInstallationId: remote.id,
    accountId: remote.account.id,
    accountLogin: remote.account.login,
  };
}

/**
 * Server-side candidate discovery: finds installation ids this SequrAI
 * user's verified GitHub identity might already have (from OUR OWN
 * database, across any organization -- a GitHub App installation is
 * shared infrastructure, not org-exclusive), then independently
 * re-verifies every one of them live against GitHub before it is ever
 * treated as a real candidate. A stale/no-longer-matching DB row can
 * never produce a false candidate this way.
 */
export async function discoverVerifiedInstallationsForUser(
  admin: SupabaseClient,
  providerId: number
): Promise<VerifiedInstallation[]> {
  const { data: rows } = await admin
    .from("github_app_installations")
    .select("github_installation_id")
    .eq("github_account_id", providerId)
    .eq("github_account_type", "User");

  const candidateIds = Array.from(
    new Set((rows ?? []).map((row) => row.github_installation_id as number))
  );

  const verified: VerifiedInstallation[] = [];
  for (const candidateId of candidateIds) {
    const result = await verifyInstallationOwnership(candidateId, providerId);
    if (result) verified.push(result);
  }
  return verified;
}
