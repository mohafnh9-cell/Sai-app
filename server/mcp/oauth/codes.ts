import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { OAuthError } from "./errors";
import { generateAuthorizationCode, hashOAuthSecret } from "./hash";
import { verifyPkce } from "./pkce";
import type { OAuthAuthorizationCodeRecord } from "./types";
import { AUTHORIZATION_CODE_TTL_SECONDS } from "./types";

export async function createAuthorizationCode(input: {
  clientId: string;
  userId: string;
  organizationId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopes: string[];
}): Promise<string> {
  const rawCode = generateAuthorizationCode();
  const codeHash = hashOAuthSecret(rawCode);
  const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString();

  const admin = createAdminClient();
  const { error } = await admin.from("mcp_oauth_authorization_codes").insert({
    code_hash: codeHash,
    client_id: input.clientId,
    user_id: input.userId,
    organization_id: input.organizationId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
    scopes: input.scopes,
    expires_at: expiresAt,
  });

  if (error) {
    throw new OAuthError("server_error", "Could not create authorization code", 500);
  }

  return rawCode;
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthAuthorizationCodeRecord> {
  const codeHash = hashOAuthSecret(input.code);
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("mcp_oauth_authorization_codes")
    .select("*")
    .eq("code_hash", codeHash)
    .maybeSingle();

  if (!row) {
    throw new OAuthError("invalid_grant", "Invalid authorization code");
  }

  const record = row as OAuthAuthorizationCodeRecord;

  if (record.consumed_at) {
    throw new OAuthError("invalid_grant", "Authorization code already used");
  }

  if (new Date(record.expires_at).getTime() <= Date.now()) {
    throw new OAuthError("invalid_grant", "Authorization code expired");
  }

  if (record.client_id !== input.clientId) {
    throw new OAuthError("invalid_grant", "Authorization code client mismatch");
  }

  if (record.redirect_uri !== input.redirectUri) {
    throw new OAuthError("invalid_grant", "Authorization code redirect_uri mismatch");
  }

  verifyPkce(input.codeVerifier, record.code_challenge, record.code_challenge_method);

  const consumedAt = new Date().toISOString();
  const { error } = await admin
    .from("mcp_oauth_authorization_codes")
    .update({ consumed_at: consumedAt })
    .eq("id", record.id)
    .is("consumed_at", null);

  if (error) {
    throw new OAuthError("invalid_grant", "Authorization code already used");
  }

  return { ...record, consumed_at: consumedAt };
}
