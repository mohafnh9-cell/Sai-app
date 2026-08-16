import "server-only";

export const ACCESS_TOKEN_PREFIX = "seq_oat_";
export const REFRESH_TOKEN_PREFIX = "seq_ort_";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60; // 10 minutes
export const AUTHORIZATION_REQUEST_TTL_SECONDS = 15 * 60; // 15 minutes

export const PKCE_METHOD_S256 = "S256" as const;
export type PkceMethod = typeof PKCE_METHOD_S256;

export type OAuthClientRecord = {
  id: string;
  client_id: string;
  client_name: string;
  client_type: "public" | "confidential";
  redirect_uris: string[];
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
};

export type OAuthAuthorizationRequestRecord = {
  id: string;
  client_id: string;
  user_id: string;
  organization_id: string;
  redirect_uri: string;
  scopes: string[];
  code_challenge: string;
  code_challenge_method: PkceMethod;
  state: string;
  expires_at: string;
  created_at: string;
};

export type OAuthAuthorizationCodeRecord = {
  id: string;
  code_hash: string;
  client_id: string;
  user_id: string;
  organization_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: PkceMethod;
  scopes: string[];
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

export type OAuthAccessTokenRecord = {
  id: string;
  token_hash: string;
  client_id: string;
  user_id: string;
  organization_id: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export type OAuthRefreshTokenRecord = {
  id: string;
  token_hash: string;
  client_id: string;
  user_id: string;
  organization_id: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  family_id: string;
  rotated_from: string | null;
  created_at: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
};
