import "server-only";

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { OAuthError } from "./errors";
import { generateOAuthSecret, hashOAuthSecret } from "./hash";
import { formatScopeString } from "./scopes";
import type { OAuthAccessTokenRecord, OAuthRefreshTokenRecord, TokenResponse } from "./types";
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./types";
import { logOAuthEvent } from "./audit";

export async function issueTokenPair(input: {
  clientId: string;
  userId: string;
  organizationId: string;
  scopes: string[];
  ip?: string | null;
}): Promise<TokenResponse> {
  const rawAccess = generateOAuthSecret(ACCESS_TOKEN_PREFIX);
  const rawRefresh = generateOAuthSecret(REFRESH_TOKEN_PREFIX);
  const accessHash = hashOAuthSecret(rawAccess);
  const refreshHash = hashOAuthSecret(rawRefresh);
  const familyId = randomUUID();

  const accessExpires = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString();
  const refreshExpires = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();

  const admin = createAdminClient();

  const { data: accessRow, error: accessError } = await admin
    .from("mcp_oauth_access_tokens")
    .insert({
      token_hash: accessHash,
      client_id: input.clientId,
      user_id: input.userId,
      organization_id: input.organizationId,
      scopes: input.scopes,
      expires_at: accessExpires,
    })
    .select("id")
    .single();

  if (accessError || !accessRow) {
    throw new OAuthError("server_error", "Could not issue access token", 500);
  }

  const { error: refreshError } = await admin.from("mcp_oauth_refresh_tokens").insert({
    token_hash: refreshHash,
    client_id: input.clientId,
    user_id: input.userId,
    organization_id: input.organizationId,
    scopes: input.scopes,
    expires_at: refreshExpires,
    family_id: familyId,
    rotated_from: null,
  });

  if (refreshError) {
    await admin.from("mcp_oauth_access_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", accessRow.id);
    throw new OAuthError("server_error", "Could not issue refresh token", 500);
  }

  logOAuthEvent({
    eventType: "oauth.token.issued",
    userId: input.userId,
    organizationId: input.organizationId,
    clientId: input.clientId,
    scopes: input.scopes,
    result: "success",
    ip: input.ip,
  });

  return {
    access_token: rawAccess,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: rawRefresh,
    scope: formatScopeString(input.scopes),
  };
}

export async function resolveOAuthAccessToken(
  rawToken: string
): Promise<(OAuthAccessTokenRecord & { rawPrefix: string }) | null> {
  if (!rawToken.startsWith(ACCESS_TOKEN_PREFIX)) return null;

  const tokenHash = hashOAuthSecret(rawToken);
  const admin = createAdminClient();
  const { data } = await admin
    .from("mcp_oauth_access_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (!data) return null;

  const record = data as OAuthAccessTokenRecord;
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return { ...record, rawPrefix: rawToken.slice(0, 16) };
}

export async function refreshOAuthTokens(input: {
  refreshToken: string;
  clientId: string;
  ip?: string | null;
}): Promise<TokenResponse> {
  const refreshHash = hashOAuthSecret(input.refreshToken);
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("mcp_oauth_refresh_tokens")
    .select("*")
    .eq("token_hash", refreshHash)
    .maybeSingle();

  if (!row) {
    throw new OAuthError("invalid_grant", "Invalid refresh token");
  }

  const record = row as OAuthRefreshTokenRecord;

  if (record.client_id !== input.clientId) {
    throw new OAuthError("invalid_grant", "Refresh token client mismatch");
  }

  if (record.revoked_at) {
    await revokeRefreshTokenFamily(record.family_id, "oauth.refresh.reuse_detected", input.ip);
    throw new OAuthError("invalid_grant", "Refresh token reuse detected");
  }

  if (new Date(record.expires_at).getTime() <= Date.now()) {
    throw new OAuthError("invalid_grant", "Refresh token expired");
  }

  const revokedAt = new Date().toISOString();
  const { error: revokeError } = await admin
    .from("mcp_oauth_refresh_tokens")
    .update({ revoked_at: revokedAt })
    .eq("id", record.id)
    .is("revoked_at", null);

  if (revokeError) {
    await revokeRefreshTokenFamily(record.family_id, "oauth.refresh.reuse_detected", input.ip);
    throw new OAuthError("invalid_grant", "Refresh token reuse detected");
  }

  const rawAccess = generateOAuthSecret(ACCESS_TOKEN_PREFIX);
  const rawRefresh = generateOAuthSecret(REFRESH_TOKEN_PREFIX);
  const accessHash = hashOAuthSecret(rawAccess);
  const refreshHashNew = hashOAuthSecret(rawRefresh);

  const accessExpires = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString();
  const refreshExpires = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();

  const { data: accessRow, error: accessError } = await admin
    .from("mcp_oauth_access_tokens")
    .insert({
      token_hash: accessHash,
      client_id: record.client_id,
      user_id: record.user_id,
      organization_id: record.organization_id,
      scopes: record.scopes,
      expires_at: accessExpires,
    })
    .select("id")
    .single();

  if (accessError || !accessRow) {
    throw new OAuthError("server_error", "Could not refresh access token", 500);
  }

  const { error: refreshInsertError } = await admin.from("mcp_oauth_refresh_tokens").insert({
    token_hash: refreshHashNew,
    client_id: record.client_id,
    user_id: record.user_id,
    organization_id: record.organization_id,
    scopes: record.scopes,
    expires_at: refreshExpires,
    family_id: record.family_id,
    rotated_from: record.id,
  });

  if (refreshInsertError) {
    throw new OAuthError("server_error", "Could not rotate refresh token", 500);
  }

  logOAuthEvent({
    eventType: "oauth.token.refreshed",
    userId: record.user_id,
    organizationId: record.organization_id,
    clientId: record.client_id,
    scopes: record.scopes,
    result: "success",
    ip: input.ip,
  });

  return {
    access_token: rawAccess,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: rawRefresh,
    scope: formatScopeString(record.scopes),
  };
}

export async function revokeOAuthToken(input: {
  token: string;
  tokenTypeHint?: "access_token" | "refresh_token";
  clientId?: string;
  ip?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const tokenHash = hashOAuthSecret(input.token);
  const revokedAt = new Date().toISOString();

  const isRefresh =
    input.tokenTypeHint === "refresh_token" || input.token.startsWith(REFRESH_TOKEN_PREFIX);
  const isAccess =
    input.tokenTypeHint === "access_token" || input.token.startsWith(ACCESS_TOKEN_PREFIX);

  if (isRefresh) {
    const { data } = await admin
      .from("mcp_oauth_refresh_tokens")
      .select("id, client_id, user_id, organization_id, scopes, family_id")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .maybeSingle();

    if (data) {
      if (input.clientId && data.client_id !== input.clientId) return;
      await admin
        .from("mcp_oauth_refresh_tokens")
        .update({ revoked_at: revokedAt })
        .eq("id", data.id);
      logOAuthEvent({
        eventType: "oauth.token.revoked",
        userId: data.user_id,
        organizationId: data.organization_id,
        clientId: data.client_id,
        scopes: data.scopes,
        result: "success",
        ip: input.ip,
      });
    }
    return;
  }

  if (isAccess) {
    const { data } = await admin
      .from("mcp_oauth_access_tokens")
      .select("id, client_id, user_id, organization_id, scopes")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .maybeSingle();

    if (data) {
      if (input.clientId && data.client_id !== input.clientId) return;
      await admin
        .from("mcp_oauth_access_tokens")
        .update({ revoked_at: revokedAt })
        .eq("id", data.id);
      logOAuthEvent({
        eventType: "oauth.token.revoked",
        userId: data.user_id,
        organizationId: data.organization_id,
        clientId: data.client_id,
        scopes: data.scopes,
        result: "success",
        ip: input.ip,
      });
    }
  }
}

async function revokeRefreshTokenFamily(
  familyId: string,
  eventType: "oauth.refresh.reuse_detected",
  ip?: string | null
): Promise<void> {
  const admin = createAdminClient();
  const revokedAt = new Date().toISOString();

  const { data: familyTokens } = await admin
    .from("mcp_oauth_refresh_tokens")
    .select("id, user_id, organization_id, client_id, scopes")
    .eq("family_id", familyId)
    .is("revoked_at", null);

  if (!familyTokens?.length) return;

  await admin
    .from("mcp_oauth_refresh_tokens")
    .update({ revoked_at: revokedAt })
    .eq("family_id", familyId)
    .is("revoked_at", null);

  const first = familyTokens[0];
  logOAuthEvent({
    eventType,
    userId: first.user_id,
    organizationId: first.organization_id,
    clientId: first.client_id,
    scopes: first.scopes,
    result: "denied",
    ip,
    metadata: { familyId, revokedCount: familyTokens.length },
  });
}
