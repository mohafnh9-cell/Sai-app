import "server-only";

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { OAuthError } from "./errors";
import { assertRedirectUriAllowed, normalizeRegisteredRedirectUri } from "./redirect-uri";
import type { OAuthClientRecord } from "./types";

export async function getOAuthClient(clientId: string): Promise<OAuthClientRecord | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("mcp_oauth_clients")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();
  return (data as OAuthClientRecord | null) ?? null;
}

export async function assertActiveOAuthClient(clientId: string): Promise<OAuthClientRecord> {
  const client = await getOAuthClient(clientId);
  if (!client) {
    throw new OAuthError("invalid_client", "Unknown or disabled client", 401);
  }
  return client;
}

export function assertClientRedirectUri(client: OAuthClientRecord, redirectUri: string): void {
  assertRedirectUriAllowed(redirectUri, client.redirect_uris);
}

export function isDcrEnabled(): boolean {
  return process.env.MCP_OAUTH_DCR_ENABLED === "true";
}

export type RegisterClientInput = {
  client_name: string;
  redirect_uris: string[];
  client_type?: "public" | "confidential";
};

export async function registerOAuthClient(input: RegisterClientInput): Promise<OAuthClientRecord> {
  if (!isDcrEnabled()) {
    throw new OAuthError("invalid_client", "Dynamic client registration is disabled", 403);
  }

  const name = input.client_name?.trim();
  if (!name || name.length > 120) {
    throw new OAuthError("invalid_request", "client_name is required");
  }

  const redirectUris = input.redirect_uris ?? [];
  if (redirectUris.length === 0 || redirectUris.length > 5) {
    throw new OAuthError("invalid_request", "At least one redirect_uri is required (max 5)");
  }

  const normalized: string[] = [];
  for (const uri of redirectUris) {
    const n = normalizeRegisteredRedirectUri(uri);
    if (!n) {
      throw new OAuthError("invalid_redirect_uri", `Invalid redirect_uri: ${uri}`);
    }
    if (!normalized.includes(n)) normalized.push(n);
  }

  const clientId = `sequrai-dcr-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mcp_oauth_clients")
    .insert({
      client_id: clientId,
      client_name: name,
      client_type: input.client_type ?? "public",
      redirect_uris: normalized,
      status: "active",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new OAuthError("server_error", "Could not register client", 500);
  }

  return data as OAuthClientRecord;
}
