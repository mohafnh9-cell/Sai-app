import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { isGitHubAppConfigured, getGitHubAppConfig } from "@/server/github-app/config";
import { finalizeGitHubAppInstallation } from "@/server/github-app/installation-events";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { getStoredGitHubToken } from "@/lib/github/token-store";
import {
  fetchAuthenticatedGitHubUser,
  filterOwnAppInstallations,
  filterSelfAuthorizedInstallations,
  listInstallationsForGitHubUser,
} from "@/server/github-app/user-installations";

export const runtime = "nodejs";

const attachBodySchema = z.object({
  // A candidate only -- never trusted on its own. It must independently
  // appear in the GitHub-verified list for the authenticated user's own
  // GitHub identity, or the request is rejected. See SECURITY MODEL below.
  installationId: z.number().int().positive().optional(),
});

/**
 * POST /api/github/app/attach
 *
 * A GitHub App installation is scoped to a GitHub account, not to a
 * SequrAI organization -- if a GitHub account already has SequrAI
 * installed (e.g. for a different SequrAI organization), revisiting the
 * normal install URL does not run a fresh install+callback round trip;
 * GitHub sends the user to its own installation-management page instead,
 * which never reaches /api/github/app/setup. This endpoint is the
 * explicit, user-initiated alternative: attach an installation GitHub
 * itself confirms belongs to the authenticated user's GitHub identity to
 * the current SequrAI organization, without requiring a fresh GitHub
 * redirect.
 *
 * SECURITY MODEL:
 * - The client-supplied installationId is only ever a candidate. The
 *   authoritative installation_id used for persistence always comes from
 *   GET /user/installations, called with the authenticated user's own
 *   stored GitHub OAuth token -- an installation this server has not
 *   independently verified as GitHub-confirmed for this exact user is
 *   never usable, no matter what the client sends.
 * - GET /user/installations proves only read/write/admin-level REPOSITORY
 *   access, never authority to authorize the App-installation-to-tenant
 *   binding itself -- an installation is only actually eligible once
 *   filterSelfAuthorizedInstallations() confirms, via a separate
 *   GET /user call, that the installation's own account IS the caller's
 *   verified GitHub identity (personal installations only; see that
 *   function's docblock for why organization-owned installations are
 *   deliberately excluded here).
 * - No GitHub username/login string is ever used to identify or match an
 *   installation.
 * - finalizeGitHubAppInstallation() (the same function the real GitHub
 *   callback uses) does all persistence -- no duplicated logic, no
 *   weakened checks.
 * - Attaching an installation to this organization never deletes or
 *   modifies its association with any other organization: the underlying
 *   table's unique key is (organization_id, github_installation_id), so a
 *   second organization attaching the same installation creates an
 *   additional row, never a reassignment.
 */
export async function POST(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      { error: "GitHub App is not configured", code: "github_app_not_configured" },
      { status: 503 }
    );
  }

  const auth = await getServerAuthContext();
  if (!auth?.organizationId) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const allowed = await assertWorkspaceMembership(
    auth.supabase,
    auth.user.id,
    auth.organizationId
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "Workspace access denied", code: "workspace_access_denied" },
      { status: 403 }
    );
  }

  const rawBody = await request.json().catch(() => ({}));
  const parsedBody = attachBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body", code: "invalid_request" }, { status: 422 });
  }

  const config = getGitHubAppConfig();
  if (!config) {
    return NextResponse.json(
      { error: "GitHub App is not configured", code: "github_app_not_configured" },
      { status: 503 }
    );
  }

  // Resolve the authenticated user's GitHub identity via their own stored
  // OAuth token -- if there isn't one, we have no way to verify anything
  // and must fail closed rather than fall back to a weaker check.
  const userToken = await getStoredGitHubToken(auth.user.id);
  if (!userToken) {
    return NextResponse.json(
      { error: "No linked GitHub account for this user", code: "github_account_not_linked" },
      { status: 409 }
    );
  }

  const verified = await listInstallationsForGitHubUser(userToken);
  if (verified === null) {
    // GitHub API unavailable/failed -- safe failure, no database mutation.
    return NextResponse.json(
      { error: "Could not reach GitHub to verify installations", code: "github_api_unavailable" },
      { status: 502 }
    );
  }

  const ownAppInstallations = filterOwnAppInstallations(verified, config.appId);
  if (ownAppInstallations.length === 0) {
    return NextResponse.json(
      { error: "No SequrAI GitHub App installation found for this GitHub account", code: "no_installation_available" },
      { status: 404 }
    );
  }

  // SECURITY: GET /user/installations only proves the user has SOME
  // (read/write/admin) access to an installation's granted repositories --
  // never sufficient on its own to authorize attaching a third-party
  // service's access on behalf of a different SequrAI organization. Only
  // installations GitHub itself confirms belong to the caller's own
  // verified GitHub identity are eligible. See filterSelfAuthorizedInstallations
  // for the full rationale.
  const self = await fetchAuthenticatedGitHubUser(userToken);
  if (!self) {
    return NextResponse.json(
      { error: "Could not verify your GitHub identity", code: "github_api_unavailable" },
      { status: 502 }
    );
  }

  const candidates = filterSelfAuthorizedInstallations(ownAppInstallations, self);
  if (candidates.length === 0) {
    // GitHub does show this account *some* installation(s) of this App --
    // just none this server can independently verify the caller is
    // authorized to attach (e.g. an organization-owned installation, which
    // this endpoint does not support attaching on read/write-collaborator
    // access alone). Distinct from "no_installation_available" so this is
    // never silently indistinguishable from "there is genuinely nothing."
    return NextResponse.json(
      {
        error: "This GitHub account has an installation this server cannot verify you're authorized to attach",
        code: "installation_requires_admin_verification",
      },
      { status: 403 }
    );
  }

  let target = candidates[0];
  if (parsedBody.data.installationId !== undefined) {
    const match = candidates.find((installation) => installation.id === parsedBody.data.installationId);
    if (!match) {
      // The client's candidate does not appear in GitHub's own verified
      // list for this user -- reject outright rather than falling back to
      // any other installation.
      return NextResponse.json(
        { error: "Installation could not be verified for this GitHub account", code: "installation_not_verified" },
        { status: 403 }
      );
    }
    target = match;
  } else if (candidates.length > 1) {
    // Ambiguous and no explicit choice was made -- never auto-select.
    return NextResponse.json(
      {
        error: "Multiple GitHub App installations are available for this account",
        code: "multiple_installations_available",
        installations: candidates.map((installation) => ({
          installationId: installation.id,
          accountLogin: installation.account.login,
          accountType: installation.account.type,
        })),
      },
      { status: 409 }
    );
  }

  const admin = createAdminClient();
  const result = await finalizeGitHubAppInstallation({
    admin,
    organizationId: auth.organizationId,
    githubInstallationId: target.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    installed: true,
    installationId: target.id,
    accountLogin: target.account.login,
    repositoryCount: result.repositoryCount,
  });
}
