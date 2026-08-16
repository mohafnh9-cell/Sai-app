# MCP OAuth 2.1 — Remote MCP Authentication

**Status:** IMPLEMENTED (Fase C)  
**Scope:** Remote MCP only (`POST /api/mcp`). Local MCP (stdio bridge) continues using `.sequrai/mcp.env` + `seq_live_*`.

---

## Overview

Remote MCP clients can authenticate with:

1. **OAuth 2.1 + PKCE S256** (recommended for Claude Desktop, ChatGPT)
2. **Legacy API keys** (`Bearer seq_live_*`) — unchanged, full access

OAuth tokens are **opaque** (`seq_oat_*`). Only SHA-256 hashes are stored server-side.

---

## Discovery

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-authorization-server` | RFC 8414 authorization server metadata |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 protected resource metadata |

Protected resource: `{APP_URL}/api/mcp`

---

## Authorization flow

```
MCP Client
  → GET /oauth/authorize (PKCE S256 + state)
  → Supabase login (if needed)
  → Consent UI (/settings/oauth/consent)
  → Authorization code (single-use, 10 min TTL)
  → POST /oauth/token (code + code_verifier)
  → access_token (1h) + refresh_token (30d, rotated)
  → POST /api/mcp (Bearer access_token)
```

---

## PKCE

- **Required:** `code_challenge` + `code_challenge_method=S256`
- **Rejected:** `plain`, missing PKCE, downgrade attempts

---

## Scopes (least privilege)

| Scope | Tools |
|---|---|
| `mcp:status:read` | `can_i_deploy`, `what_changed`, `production_history` |
| `mcp:discover:read` | `discover_application` |
| `mcp:fix:read` | `safe_fix` |
| `mcp:review:run` | `review_now`, `cancel_review` |
| `mcp:audit:run` | `full_product_audit` |
| `mcp:target:authorize` | `authorize_dynamic_target` |

Legacy API keys receive **all scopes** implicitly.

---

## Token lifecycle

| Token | Format | TTL | Storage |
|---|---|---|---|
| Access | `seq_oat_*` | 1 hour | SHA-256 hash |
| Refresh | `seq_ort_*` | 30 days | SHA-256 hash, family rotation |
| Auth code | opaque | 10 min | SHA-256 hash, single-use |

**Refresh rotation:** each refresh invalidates the previous refresh token and issues a new pair. Reuse of a revoked refresh token revokes the entire token family.

**Revocation:** `POST /oauth/token/revoke` — RFC 7009 semantics (always 200, no leakage).

---

## Tenant isolation

- `organization_id` is bound to the token at issuance from the user's active workspace.
- Client-supplied `projectId` / `repositoryFullName` never override tenant scope.
- `resolveMcpProject()` remains the single project resolution choke point.

---

## Client registration

**Default:** pre-registered clients (`sequrai-mcp-inspector`, `sequrai-claude-desktop`, `sequrai-chatgpt`).

**DCR:** disabled by default. Enable with `MCP_OAUTH_DCR_ENABLED=true`. Rate-limited, strict redirect URI validation.

Redirect URIs: **exact match** on scheme + host + port + path. No wildcards.

---

## Audit events

Logged (never secrets):

- `oauth.authorization.started|denied|completed`
- `oauth.token.issued|refreshed|revoked`
- `oauth.refresh.reuse_detected`
- `oauth.client.registered`
- `oauth.scope.denied`

---

## Threat model (addressed)

- Authorization code replay → single-use + expiry
- PKCE downgrade → S256 only
- Redirect manipulation → exact-match allowlist
- CSRF → mandatory `state`
- Refresh reuse → family revocation
- Scope escalation → centralized `assertToolScope()`
- Cross-tenant access → org-bound tokens + `resolveMcpProject()`
- Token leakage → hash-only storage, forbidden log keys

---

## Local vs Remote

| Surface | Auth | Analyzes |
|---|---|---|
| **Local MCP** | `.sequrai/mcp.env` / API key | Workspace on your machine |
| **Remote MCP** | OAuth or API key | GitHub repositories connected to your org |

OAuth remote tokens **never** grant filesystem access to your local machine.
