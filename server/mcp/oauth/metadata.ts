import "server-only";

import { ALL_MCP_SCOPES } from "./scopes";
import { PKCE_METHOD_S256 } from "./types";
import { isDcrEnabled } from "./clients";

export function getOAuthIssuer(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_APP_URL is required for MCP OAuth");
  }
  return url.replace(/\/$/, "");
}

export function buildAuthorizationServerMetadata() {
  const issuer = getOAuthIssuer();
  const metadata: Record<string, unknown> = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: [PKCE_METHOD_S256],
    scopes_supported: [...ALL_MCP_SCOPES],
    token_endpoint_auth_methods_supported: ["none"],
    service_documentation: `${issuer}/docs/MCP_OAUTH.md`,
  };

  if (isDcrEnabled()) {
    metadata.registration_endpoint = `${issuer}/oauth/register`;
  }

  return metadata;
}

export function buildProtectedResourceMetadata() {
  const issuer = getOAuthIssuer();
  return {
    resource: `${issuer}/api/mcp`,
    authorization_servers: [issuer],
    scopes_supported: [...ALL_MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${issuer}/docs/MCP_OAUTH.md`,
  };
}
