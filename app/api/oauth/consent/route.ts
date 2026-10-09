import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOAuthClient } from "@/server/mcp/oauth/clients";
import {
  deleteAuthorizationRequest,
  getAuthorizationRequest,
} from "@/server/mcp/oauth/authorization-requests";
import { createAuthorizationCode } from "@/server/mcp/oauth/codes";
import { logOAuthEvent, clientIp } from "@/server/mcp/oauth/audit";
import { SCOPE_DESCRIPTIONS, isSensitiveMcpScope, resolveGrantedScopes } from "@/server/mcp/oauth/scopes";
import { McpError } from "@/server/mcp/auth";
import type { McpScope } from "@/server/mcp/oauth/scopes";
import { OAuthError, oauthErrorResponse } from "@/server/mcp/oauth/errors";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { z } from "zod";

const consentBodySchema = z.object({
  request_id: z.string().trim().min(1),
  action: z.enum(["approve", "deny"]),
  /** The capabilities the person chose to grant (subset of what was requested). Absent = the non-sensitive ones only. */
  scopes: z.array(z.string().trim().min(1)).max(16).optional(),
});

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request, { keyPrefix: "oauth-consent-get", limit: 30 });
  if (rateLimited) return rateLimited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestId = new URL(request.url).searchParams.get("request_id")?.trim();
  if (!requestId) {
    return NextResponse.json({ error: "Missing request_id" }, { status: 400 });
  }

  const authRequest = await getAuthorizationRequest(requestId, user.id);
  if (!authRequest) {
    return NextResponse.json({ error: "Authorization request expired or not found" }, { status: 404 });
  }

  const client = await getOAuthClient(authRequest.client_id);
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const scopeDetails = authRequest.scopes.map((scope) => ({
    scope,
    description: SCOPE_DESCRIPTIONS[scope as McpScope]?.en ?? scope,
    // Sensitive capabilities start UNCHECKED on the consent screen: the person must opt in to each.
    sensitive: isSensitiveMcpScope(scope),
    defaultGranted: !isSensitiveMcpScope(scope),
  }));

  return NextResponse.json({
    requestId: authRequest.id,
    clientName: client.client_name,
    clientId: authRequest.client_id,
    organizationId: authRequest.organization_id,
    scopes: scopeDetails,
    redirectUri: authRequest.redirect_uri,
  });
}

export async function POST(request: Request) {
  const rateLimited = await enforceRateLimit(request, { keyPrefix: "oauth-consent-post", limit: 20 });
  if (rateLimited) return rateLimited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = consentBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { request_id: requestId, action, scopes: selectedScopes } = parsed.data;

  const authRequest = await getAuthorizationRequest(requestId, user.id);
  if (!authRequest) {
    return NextResponse.json({ error: "Authorization request expired or not found" }, { status: 404 });
  }

  const redirectBase = authRequest.redirect_uri;
  const state = authRequest.state;

  try {
    if (action === "deny") {
      await deleteAuthorizationRequest(requestId);
      logOAuthEvent({
        eventType: "oauth.authorization.denied",
        userId: user.id,
        organizationId: authRequest.organization_id,
        clientId: authRequest.client_id,
        scopes: authRequest.scopes,
        result: "denied",
        ip: clientIp(request),
      });

      const url = new URL(redirectBase);
      url.searchParams.set("error", "access_denied");
      url.searchParams.set("error_description", "The user denied the request");
      url.searchParams.set("state", state);
      return NextResponse.json({ redirectTo: url.toString() });
    }

    // What is granted is decided here from what the person selected, not from what the client requested.
    let grantedScopes: string[];
    try {
      grantedScopes = resolveGrantedScopes(authRequest.scopes, selectedScopes);
    } catch (error) {
      if (error instanceof McpError) {
        return NextResponse.json({ error: "invalid_scope", error_description: error.message }, { status: 400 });
      }
      throw error;
    }

    const code = await createAuthorizationCode({
      clientId: authRequest.client_id,
      userId: authRequest.user_id,
      organizationId: authRequest.organization_id,
      redirectUri: authRequest.redirect_uri,
      codeChallenge: authRequest.code_challenge,
      codeChallengeMethod: authRequest.code_challenge_method,
      scopes: grantedScopes,
    });

    await deleteAuthorizationRequest(requestId);

    logOAuthEvent({
      eventType: "oauth.authorization.completed",
      userId: user.id,
      organizationId: authRequest.organization_id,
      clientId: authRequest.client_id,
      scopes: grantedScopes,
      result: "success",
      metadata: { requestedScopes: authRequest.scopes, narrowed: grantedScopes.length < authRequest.scopes.length },
      ip: clientIp(request),
    });

    const url = new URL(redirectBase);
    url.searchParams.set("code", code);
    url.searchParams.set("state", state);
    return NextResponse.json({ redirectTo: url.toString() });
  } catch (error) {
    if (error instanceof OAuthError) {
      return oauthErrorResponse(error, { redirectUri: redirectBase, state });
    }
    console.error("[api/oauth/consent] unexpected error");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
