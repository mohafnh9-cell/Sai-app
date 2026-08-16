import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { revokeOAuthToken } from "@/server/mcp/oauth/tokens";
import { OAuthError, oauthErrorResponse } from "@/server/mcp/oauth/errors";
import { parseOAuthFormBody } from "@/server/mcp/oauth/form-body";
import { clientIp } from "@/server/mcp/oauth/audit";

export const runtime = "nodejs";

const OAUTH_REVOKE_RATE_LIMIT = {
  keyPrefix: "oauth-revoke",
  limit: 30,
  windowMs: 60_000,
};

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, OAUTH_REVOKE_RATE_LIMIT);
  if (rateLimited) return rateLimited;

  try {
    const body = await parseOAuthFormBody(request);
    const token = body.token?.trim();
    if (!token) {
      throw new OAuthError("invalid_request", "token is required");
    }

    const tokenTypeHint =
      body.token_type_hint === "refresh_token"
        ? "refresh_token"
        : body.token_type_hint === "access_token"
          ? "access_token"
          : undefined;

    await revokeOAuthToken({
      token,
      tokenTypeHint,
      clientId: body.client_id?.trim() || undefined,
      ip: clientIp(request),
    });

    // RFC 7009: always 200, no information leakage
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    if (error instanceof OAuthError) {
      return oauthErrorResponse(error);
    }
    return new NextResponse(null, { status: 200 });
  }
}
