import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveWorkspaceIdForUser } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { assertActiveOAuthClient, assertClientRedirectUri } from "@/server/mcp/oauth/clients";
import { OAuthError, oauthErrorResponse } from "@/server/mcp/oauth/errors";
import { validateCodeChallenge, validatePkceMethod } from "@/server/mcp/oauth/pkce";
import { parseScopeString, ALL_MCP_SCOPES } from "@/server/mcp/oauth/scopes";
import { createAuthorizationRequest } from "@/server/mcp/oauth/authorization-requests";
import { logOAuthEvent, clientIp } from "@/server/mcp/oauth/audit";
import { getOAuthIssuer } from "@/server/mcp/oauth/metadata";

export const runtime = "nodejs";

const OAUTH_AUTHORIZE_RATE_LIMIT = {
  keyPrefix: "oauth-authorize",
  limit: 30,
  windowMs: 60_000,
};

export async function GET(request: Request) {
  const rateLimited = enforceRateLimit(request, OAUTH_AUTHORIZE_RATE_LIMIT);
  if (rateLimited) return rateLimited;

  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id")?.trim();
  const redirectUri = url.searchParams.get("redirect_uri")?.trim();
  const responseType = url.searchParams.get("response_type")?.trim();
  const scope = url.searchParams.get("scope");
  const state = url.searchParams.get("state")?.trim();
  const codeChallenge = url.searchParams.get("code_challenge")?.trim();
  const codeChallengeMethod = url.searchParams.get("code_challenge_method")?.trim();

  try {
    if (!clientId) throw new OAuthError("invalid_request", "client_id is required");
    if (!redirectUri) throw new OAuthError("invalid_request", "redirect_uri is required");
    if (responseType !== "code") {
      throw new OAuthError("unsupported_response_type", "Only response_type=code is supported");
    }
    if (!state) throw new OAuthError("invalid_request", "state is required");
    if (!codeChallenge) throw new OAuthError("invalid_request", "code_challenge is required");

    validatePkceMethod(codeChallengeMethod);
    validateCodeChallenge(codeChallenge);

    const client = await assertActiveOAuthClient(clientId);
    assertClientRedirectUri(client, redirectUri);

    const scopes = parseScopeString(scope);
    if (scopes.length === 0) {
      throw new OAuthError("invalid_scope", "No valid scopes requested");
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const loginUrl = new URL("/login", getOAuthIssuer());
      loginUrl.searchParams.set("redirectTo", request.url);
      return NextResponse.redirect(loginUrl.toString(), 302);
    }

    const organizationId = await resolveActiveWorkspaceIdForUser(supabase, user.id);
    if (!organizationId) {
      throw new OAuthError("access_denied", "No active organization", 403, state);
    }

    const authRequest = await createAuthorizationRequest({
      clientId,
      userId: user.id,
      organizationId,
      redirectUri,
      scopes,
      codeChallenge,
      codeChallengeMethod: codeChallengeMethod ?? "S256",
      state,
    });

    logOAuthEvent({
      eventType: "oauth.authorization.started",
      userId: user.id,
      organizationId,
      clientId,
      scopes,
      result: "success",
      ip: clientIp(request),
    });

    const consentUrl = new URL("/settings/oauth/consent", getOAuthIssuer());
    consentUrl.searchParams.set("request_id", authRequest.id);
    return NextResponse.redirect(consentUrl.toString(), 302);
  } catch (error) {
    if (error instanceof OAuthError) {
      if (redirectUri && state) {
        return oauthErrorResponse(error, { redirectUri, state });
      }
      return oauthErrorResponse(error);
    }
    console.error("[oauth/authorize] unexpected error");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

// Export for tests
export { ALL_MCP_SCOPES };
