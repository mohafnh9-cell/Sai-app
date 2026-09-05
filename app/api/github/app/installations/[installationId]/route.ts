import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { loadInstallationByRowId, markInstallationRevoked } from "@/server/github-app/installation-store";

export const runtime = "nodejs";

const paramsSchema = z.object({ installationId: z.string().uuid() });

/**
 * Phase 31.2 (Task 2): in-app "disconnect" for a GitHub App installation.
 *
 * DESIGN DECISION -- local revoke only, not a real GitHub-side uninstall:
 * GitHub itself is already the source of truth for installation removal --
 * uninstalling from GitHub's own settings UI fires the `installation`
 * webhook's `deleted` event, which calls this exact same
 * markInstallationRevoked() (server/github-app/installation-store.ts,
 * see server/github-app/installation-events.ts's webhook handler). This
 * route reuses that identical, already-battle-tested primitive rather than
 * inventing a second, competing ownership model.
 *
 * A true GitHub-side uninstall (DELETE /app/installations/{id} with an
 * app-level JWT) is technically possible from this server -- the JWT
 * infrastructure already exists (github-api.ts's fetchGitHubInstallation
 * uses the same auth for a GET). It was deliberately NOT implemented here:
 * it is an irreversible action that revokes SequrAI's access to every
 * repository under the installation (potentially an entire GitHub
 * organization) with no GitHub-side confirmation step for the user to see
 * or cancel. Performing that unilaterally from a single DELETE call this
 * route's caller might not fully realize the blast radius of is a
 * meaningfully riskier design than the alternative: revoke SequrAI's own
 * local relationship immediately (safe, reversible by reconnecting), and
 * tell the caller exactly where to go on GitHub if they also want to
 * revoke GitHub's side of the grant.
 */
async function handleDisconnect(
  request: Request,
  { params }: { params: Promise<{ installationId: string }> }
) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid installation id", code: "invalid_installation_id" }, { status: 400 });
  }

  const auth = await getServerAuthContext();
  if (!auth?.organizationId) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const allowed = await assertWorkspaceMembership(auth.supabase, auth.user.id, auth.organizationId);
  if (!allowed) {
    return NextResponse.json({ error: "Workspace access denied", code: "workspace_access_denied" }, { status: 403 });
  }

  const admin = createAdminClient();

  // organizationId is ALWAYS the authenticated user's own active
  // organization (never taken from the request) -- loadInstallationByRowId
  // double-scopes by id AND organization_id, so an installationId belonging
  // to a different organization returns null here, identically to "not
  // found." This is what prevents Org A from disconnecting Org B's
  // installation: there is no code path where a cross-org id resolves to a
  // real row.
  const installation = await loadInstallationByRowId(admin, {
    installationRowId: parsedParams.data.installationId,
    organizationId: auth.organizationId,
  });
  if (!installation) {
    return NextResponse.json(
      { error: "GitHub App installation not found", code: "installation_not_found" },
      { status: 404 }
    );
  }

  const alreadyRevoked = installation.status === "revoked" || Boolean(installation.revoked_at);

  // markInstallationRevoked is idempotent (a plain UPDATE, org-scoped) --
  // safe to call again even if already revoked, so a retried/duplicate
  // DELETE never errors or double-processes.
  await markInstallationRevoked(admin, {
    installationRowId: installation.id,
    organizationId: auth.organizationId,
  });

  const githubUninstallUrl =
    installation.github_account_type === "Organization"
      ? `https://github.com/organizations/${installation.github_account_login}/settings/installations/${installation.github_installation_id}`
      : `https://github.com/settings/installations/${installation.github_installation_id}`;

  return NextResponse.json({
    ok: true,
    alreadyRevoked,
    installationId: installation.id,
    // This app's own record of the relationship is gone; the grant on
    // GitHub's side is untouched until the caller acts on this URL.
    revokedLocally: true,
    githubUninstallRequired: true,
    githubUninstallUrl,
  });
}

export { handleDisconnect as DELETE };
