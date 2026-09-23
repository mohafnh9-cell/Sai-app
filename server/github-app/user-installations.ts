import "server-only";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export type GitHubUserInstallation = {
  id: number;
  app_id: number;
  account: {
    id: number;
    login: string;
    type: "User" | "Organization";
  };
  repository_selection: "all" | "selected";
  suspended_at: string | null;
};

/**
 * Lists the GitHub App installations GitHub itself confirms are accessible
 * to the authenticated GitHub user behind `userAccessToken` --
 * GET /user/installations is scoped by GitHub's own access control to only
 * installations that user can see, so this is real, server-verified
 * evidence of "this GitHub identity has this installation," never a claim
 * inferred from a login/name string or trusted from client input.
 *
 * Returns null (not []) on any API failure, so callers can distinguish
 * "verified: this account genuinely has zero matching installations" from
 * "unverifiable: GitHub API call failed" -- the two must never be treated
 * the same, since the caller must not mutate anything on the latter.
 */
export async function listInstallationsForGitHubUser(
  userAccessToken: string
): Promise<GitHubUserInstallation[] | null> {
  try {
    const response = await fetch(`${GITHUB_API}/user/installations`, {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
      cache: "no-store",
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { installations?: GitHubUserInstallation[] };
    return data.installations ?? [];
  } catch {
    return null;
  }
}

/**
 * Narrows a verified installation list down to installations of THIS
 * SequrAI GitHub App specifically (a user's GET /user/installations
 * response can include installations of unrelated GitHub Apps they've
 * authorized) and excludes suspended installations, which must never be
 * attachable.
 */
export function filterOwnAppInstallations(
  installations: GitHubUserInstallation[],
  appId: string
): GitHubUserInstallation[] {
  return installations.filter(
    (installation) => String(installation.app_id) === appId && !installation.suspended_at
  );
}

export type GitHubAuthenticatedUser = {
  id: number;
  login: string;
};

/**
 * Resolves the GitHub identity behind a stored user access token, via
 * GitHub itself -- never inferred from anything the client or our own
 * database claims.
 */
export async function fetchAuthenticatedGitHubUser(
  userAccessToken: string
): Promise<GitHubAuthenticatedUser | null> {
  try {
    const response = await fetch(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { id?: number; login?: string };
    if (typeof data.id !== "number" || typeof data.login !== "string") return null;
    return { id: data.id, login: data.login };
  } catch {
    return null;
  }
}

/**
 * SECURITY: GET /user/installations proves only that the authenticated
 * GitHub user has *some* access (read, write, OR admin) to an
 * installation's granted repositories -- e.g. an outside collaborator
 * added to a single repository inside an organization-wide "selected
 * repositories" installation shows up here too. It does NOT prove the
 * user has authority to decide that a third-party service (SequrAI)
 * should be granted that installation's access on behalf of a
 * *different* SequrAI organization -- attaching on read/write-collaborator
 * access alone would let any such collaborator hand an unrelated
 * organization's GitHub access to a SequrAI workspace they merely happen
 * to also be a member of.
 *
 * GitHub's REST API has no simple "does this token's user administer this
 * specific App installation" endpoint, and this app's only GitHub OAuth
 * scope (read:user user:email, see lib/auth/start-github-connect.ts) does
 * not include read:org, so an organization-membership-role check
 * (GET /orgs/{org}/memberships/{username}, which needs broader scope) is
 * not reliably available either -- attempting it anyway on an
 * insufficiently-scoped token risks a false negative or false positive
 * that would be worse than a clear, conservative refusal.
 *
 * The one case GitHub's own semantics make unambiguous without any extra
 * scope: a *personal* (account.type === "User") installation can only
 * ever have been installed by that individual GitHub account itself --
 * there is no "collaborator" concept for a personal account's own App
 * installations. So this only authorizes attaching installations where
 * the installation's account IS the authenticated user's own verified
 * GitHub identity (confirmed via GET /user, never trusted from the
 * installation list's account.login string). Organization-owned
 * installations are never eligible through this path until a real
 * admin-verified check is added.
 */
export function filterSelfAuthorizedInstallations(
  installations: GitHubUserInstallation[],
  self: GitHubAuthenticatedUser
): GitHubUserInstallation[] {
  return installations.filter(
    (installation) => installation.account.type === "User" && installation.account.id === self.id
  );
}
