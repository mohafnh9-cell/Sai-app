import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { OAuthError } from "./errors";
import type { OAuthAuthorizationRequestRecord } from "./types";
import { AUTHORIZATION_REQUEST_TTL_SECONDS } from "./types";

export async function createAuthorizationRequest(input: {
  clientId: string;
  userId: string;
  organizationId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
}): Promise<OAuthAuthorizationRequestRecord> {
  const expiresAt = new Date(
    Date.now() + AUTHORIZATION_REQUEST_TTL_SECONDS * 1000
  ).toISOString();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mcp_oauth_authorization_requests")
    .insert({
      client_id: input.clientId,
      user_id: input.userId,
      organization_id: input.organizationId,
      redirect_uri: input.redirectUri,
      scopes: input.scopes,
      code_challenge: input.codeChallenge,
      code_challenge_method: input.codeChallengeMethod,
      state: input.state,
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new OAuthError("server_error", "Could not create authorization request", 500);
  }

  return data as OAuthAuthorizationRequestRecord;
}

export async function getAuthorizationRequest(
  requestId: string,
  userId: string
): Promise<OAuthAuthorizationRequestRecord | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("mcp_oauth_authorization_requests")
    .select("*")
    .eq("id", requestId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;

  const record = data as OAuthAuthorizationRequestRecord;
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    await admin.from("mcp_oauth_authorization_requests").delete().eq("id", requestId);
    return null;
  }

  return record;
}

export async function deleteAuthorizationRequest(requestId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("mcp_oauth_authorization_requests").delete().eq("id", requestId);
}
