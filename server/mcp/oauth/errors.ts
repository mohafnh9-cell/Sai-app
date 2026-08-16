import "server-only";

import { NextResponse } from "next/server";

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_scope"
  | "invalid_redirect_uri"
  | "unauthorized_client"
  | "access_denied"
  | "server_error"
  | "unsupported_grant_type"
  | "unsupported_response_type";

export class OAuthError extends Error {
  constructor(
    public readonly code: OAuthErrorCode,
    message: string,
    public readonly status = 400,
    public readonly state?: string
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

export function oauthErrorResponse(
  error: OAuthError,
  options?: { redirectUri?: string; state?: string }
): NextResponse {
  if (options?.redirectUri && options.state !== undefined) {
    const url = new URL(options.redirectUri);
    url.searchParams.set("error", error.code);
    url.searchParams.set("error_description", error.message);
    url.searchParams.set("state", options.state);
    return NextResponse.redirect(url.toString(), 302);
  }

  return NextResponse.json(
    {
      error: error.code,
      error_description: error.message,
    },
    { status: error.status }
  );
}

export function mcpUnauthorizedResponse(message = "Unauthorized"): NextResponse {
  const issuer = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const resourceMetadata = issuer
    ? `${issuer}/.well-known/oauth-protected-resource`
    : undefined;

  const wwwAuth = resourceMetadata
    ? `Bearer realm="sequrai-mcp", resource_metadata="${resourceMetadata}"`
    : `Bearer realm="sequrai-mcp"`;

  return NextResponse.json(
    { error: "invalid_token", error_description: message, code: "unauthorized" },
    {
      status: 401,
      headers: { "WWW-Authenticate": wwwAuth },
    }
  );
}

export function mcpInsufficientScopeResponse(scope?: string): NextResponse {
  const wwwAuth = scope
    ? `Bearer realm="sequrai-mcp", error="insufficient_scope", scope="${scope}"`
    : `Bearer realm="sequrai-mcp", error="insufficient_scope"`;

  return NextResponse.json(
    { error: "insufficient_scope", error_description: "Insufficient scope for this tool" },
    {
      status: 403,
      headers: { "WWW-Authenticate": wwwAuth },
    }
  );
}
