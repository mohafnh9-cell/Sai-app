/**
 * Single source of truth for "this route is protected by a mechanism our
 * regex-based rules can't see" — auth helper names, and path prefixes for
 * endpoints that are public or machine-authenticated by design.
 *
 * Every rule that reasons about "does this route have auth/authz/CSRF
 * protection" must import from here instead of maintaining its own
 * exclusion list. Three separate rules (auth.missing, authz.insufficient,
 * web.csrf-missing) each grew their own ad-hoc exclusions before this
 * module existed, and each one independently missed routes the others
 * already knew about — found only by running the AI Red Team against
 * production and manually verifying every "confirmed" finding. Add new
 * exclusions here once, not per-rule.
 */

/** Function/header names that indicate a request is authenticated, even
 * when no session cookie is involved (signatures, tokens, PKCE, API keys). */
export const RECOGNIZED_AUTH_PATTERN =
  /(?:auth\(|getServerSession|getServerAuthContext|getCachedServerAuthContext|getScanRequestContext|getScanAccessContext|resolveMcpAuth|assertInternalOpsAuthorized|verifyInternalOpsRequest|serve\s*\(|signingKey|verifyGitHubWebhookSignature|verifyStripeWebhookSignature|constructEvent|webhookSecret|exchangeCodeForSession|currentUser|getUser|verifyToken|requireAuth|Authorization|supabase\.auth\.getUser|requireCiProjectAccess|requireProjectApiAccess|code_verifier|codeVerifier|assertActiveOAuthClient)/i;

export const RECOGNIZED_AUTHZ_PATTERN =
  /(?:authorize|permission|role|ownerId|organizationId|organization_id|userId\s*[=!]==?|can\w+\(|policy|getServerAuthContext|getCachedServerAuthContext|getScanRequestContext|getScanAccessContext|resolveMcpAuth|assertInternalOpsAuthorized|verifyInternalOpsRequest|requireProjectApiAccess|getProjectAccessForUser|canAccessRepository|verifyGitHubWebhookSignature|verifyStripeWebhookSignature|constructEvent|requireCiProjectAccess)/i;

/** Test/fixture/example files — never real production surface. */
export const TEST_OR_EXAMPLE_PATH =
  /(?:^|\/)(?:test|tests|__tests__|fixtures?|examples?)(?:\/|$)|\.(?:test|spec)\./i;

/**
 * Routes that are public or machine-authenticated *by specification*, not
 * by oversight: RFC-mandated public OAuth endpoints (register RFC 7591,
 * revoke RFC 7009, token exchange protected by PKCE RFC 7636 rather than a
 * browser session), OAuth/GitHub callback handlers, signature-verified
 * webhook receivers, public discovery metadata (RFC 8414 / RFC 9728), and
 * internal-only API routes.
 *
 * Deliberately narrow, not a blanket "/oauth/" prefix: /oauth/authorize
 * and /oauth/consent *do* use a browser session (supabase.auth.getUser)
 * and must stay subject to auth/CSRF checks.
 */
export const MACHINE_ENDPOINT_PATH =
  /\/oauth\/(?:register|revoke|token)(?:\/|$)|\/\.well-known\/|\/auth\/callback\/|\/webhooks?\/|\/api\/internal\//i;
