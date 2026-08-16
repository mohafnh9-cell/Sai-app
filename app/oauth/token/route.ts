import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { exchangeAuthorizationCode } from "@/server/mcp/oauth/codes";
import { assertActiveOAuthClient } from "@/server/mcp/oauth/clients";
import { OAuthError, oauthErrorResponse } from "@/server/mcp/oauth/errors";
import { parseOAuthFormBody } from "@/server/mcp/oauth/form-body";
import { issueTokenPair, refreshOAuthTokens } from "@/server/mcp/oauth/tokens";
import { clientIp } from "@/server/mcp/oauth/audit";

export const runtime = "nodejs";

const OAUTH_TOKEN_RATE_LIMIT = {
  keyPrefix: "oauth-token",
  limit: 60,
  windowMs: 60_000,
};

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, OAUTH_TOKEN_RATE_LIMIT);
  if (rateLimited) return rateLimited;

  try {
    const body = await parseOAuthFormBody(request);
    const grantType = body.grant_type?.trim();

    if (grantType === "authorization_code") {
      const code = body.code?.trim();
      const redirectUri = body.redirect_uri?.trim();
      const clientId = body.client_id?.trim();
      const codeVerifier = body.code_verifier?.trim();

      if (!code || !redirectUri || !clientId || !codeVerifier) {
        throw new OAuthError("invalid_request", "Missing required parameters");
      }

      await assertActiveOAuthClient(clientId);
      const authCode = await exchangeAuthorizationCode({
        code,
        clientId,
        redirectUri,
        codeVerifier,
      });

      const tokenResponse = await issueTokenPair({
        clientId: authCode.client_id,
        userId: authCode.user_id,
        organizationId: authCode.organization_id,
        scopes: authCode.scopes,
        ip: clientIp(request),
      });

      return NextResponse.json(tokenResponse);
    }

    if (grantType === "refresh_token") {
      const refreshToken = body.refresh_token?.trim();
      const clientId = body.client_id?.trim();
      if (!refreshToken || !clientId) {
        throw new OAuthError("invalid_request", "Missing refresh_token or client_id");
      }

      await assertActiveOAuthClient(clientId);
      const tokenResponse = await refreshOAuthTokens({
        refreshToken,
        clientId,
        ip: clientIp(request),
      });

      return NextResponse.json(tokenResponse);
    }

    throw new OAuthError("unsupported_grant_type", "Unsupported grant_type");
  } catch (error) {
    if (error instanceof OAuthError) {
      return oauthErrorResponse(error);
    }
    if (error instanceof Error && error.message.startsWith("missing:")) {
      return oauthErrorResponse(new OAuthError("invalid_request", "Missing required parameters"));
    }
    console.error("[oauth/token] unexpected error");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
