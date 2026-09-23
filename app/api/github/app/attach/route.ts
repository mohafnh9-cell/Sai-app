import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { isGitHubAppConfigured } from "@/server/github-app/config";
import { finalizeGitHubAppInstallation } from "@/server/github-app/installation-events";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import {
  discoverVerifiedInstallationsForUser,
  resolveGitHubProviderId,
  verifyInstallationOwnership,
} from "@/server/github-app/installation-authorization";

export const runtime = "nodejs";

const attachBodySchema = z.object({
  // Only ever a UI selector among already-server-verified candidates --
  // never trusted on its own. See SECURITY MODEL below.
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
 * explicit, user-initiated alternative: attach an installation
 * independently verified to belong to the authenticated user's own
 * GitHub identity to the current SequrAI organization.
 *
 * SECURITY MODEL:
 * - GitHub identity comes ONLY from Supabase's own auth.identities record
 *   (resolveGitHubProviderId) -- the immutable numeric provider id
 *   Supabase itself recorded when this user authenticated via GitHub.
 *   Never a login/username string, never a client-supplied value.
 * - Installation facts come ONLY from a live GET /app/installations/{id}
 *   call signed with this app's own JWT (verifyInstallationOwnership) --
 *   never trusted from the database or the client without this live
 *   re-check.
 * - An installation is only ever eligible when: it is independently
 *   confirmed to belong to this app (an id for a different app simply
 *   404s), account.type === "User" (organization-owned installations are
 *   never attachable through this path -- there is no reliable way to
 *   verify org-admin authority without a real user-token/OAuth flow this
 *   app deliberately does not introduce), account.id === the caller's own
 *   verified provider id, and it is not suspended.
 * - A client-supplied installationId is only ever a selector among
 *   candidates this server already discovered and verified -- it can
 *   never introduce a new, unverified candidate.
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

  const admin = createAdminClient();

  const providerId = await resolveGitHubProviderId(admin, auth.user.id);
  if (providerId === null) {
    return NextResponse.json(
      { error: "No verified GitHub identity for this user", code: "github_identity_not_linked" },
      { status: 409 }
    );
  }

  let target;
  if (parsedBody.data.installationId !== undefined) {
    // A client-supplied candidate is only ever a selector -- independently
    // re-verified live against GitHub before it can be used for anything.
    target = await verifyInstallationOwnership(parsedBody.data.installationId, providerId);
    if (!target) {
      return NextResponse.json(
        { error: "Installation could not be verified for this GitHub account", code: "installation_not_verified" },
        { status: 403 }
      );
    }
  } else {
    const candidates = await discoverVerifiedInstallationsForUser(admin, providerId);
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "No verified GitHub App installation found for this account", code: "no_installation_available" },
        { status: 404 }
      );
    }
    if (candidates.length > 1) {
      // Ambiguous and no explicit choice was made -- never auto-select.
      return NextResponse.json(
        {
          error: "Multiple GitHub App installations are available for this account",
          code: "multiple_installations_available",
          installations: candidates.map((installation) => ({
            installationId: installation.githubInstallationId,
            accountLogin: installation.accountLogin,
          })),
        },
        { status: 409 }
      );
    }
    target = candidates[0];
  }

  const result = await finalizeGitHubAppInstallation({
    admin,
    organizationId: auth.organizationId,
    githubInstallationId: target.githubInstallationId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    installed: true,
    installationId: target.githubInstallationId,
    accountLogin: target.accountLogin,
    repositoryCount: result.repositoryCount,
  });
}
