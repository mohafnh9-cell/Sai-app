# MCP V1 — Security Model

**Status:** IMPLEMENTED
**Scope:** `app/api/mcp/route.ts`, `server/mcp/**`, `mcp/stdio-bridge.mjs`.

---

## 1. Authentication

- **Model:** long-lived API keys, one per (organization, purpose), created and revoked by an authenticated org member through the SequrAI web app (`app/api/mcp/keys/route.ts`, protected by normal Supabase session auth — never by the MCP key itself).
- **Format:** `seq_live_<48 hex chars>` (`generateMcpApiKey`, `server/mcp/auth.ts`). The prefix makes keys grep-able/identifiable in logs and secret scanners without exposing the secret.
- **Storage:** only a SHA-256 hash (`key_hash`) and a display prefix (`key_prefix`, first 16 chars) are stored in `mcp_api_keys`. The raw key is shown to the user exactly once, at creation time, and is never persisted or logged in plaintext anywhere.
- **Verification:** `resolveMcpAuth()` reads the `Authorization: Bearer <key>` header, rejects anything not prefixed `seq_live_`, hashes it, and looks up an active (`revoked_at IS NULL`) row. No match → `null` → the route returns a generic `401 unauthorized` with no indication of *why* (key format wrong vs. not found vs. revoked are indistinguishable to the caller).
- **Revocation:** setting `revoked_at` on the row (`DELETE /api/mcp/keys?id=...`) is immediate and checked on every request via the `.is("revoked_at", null)` filter — no caching, no grace period.
- **Key material never appears in:** MCP responses, `logMcpCall` entries, error messages, or the stdio bridge's stderr banner (which only prints the resolved `SEQURAI_API_URL`, never the key).

## 2. Authorization / tenant isolation

- Every authenticated call carries `organizationId`, derived server-side from the API key's owning organization row — never from client input.
- `resolveMcpProject()` is the single choke point for turning a client-supplied `projectId` / `repositoryId` / `repositoryFullName` into an actual project. It always filters by `organization_id = ctx.organizationId` in the same query that looks up the project. A client cannot access another organization's project by guessing or supplying its ID: the row simply won't match the filter, and the tool returns the same `project_not_found` error it would return for a nonexistent ID — **cross-tenant existence is never leaked** (no "found, but not yours" response).
- `assertProjectInOrg()` (`server/mcp/auth.ts`) provides the same guarantee for any future code path that needs a project-scoped assertion outside the five canonical tools.
- Verified in `server/mcp/__tests__/canonical-tools.test.ts` (`enforces tenant isolation: cannot access a project from another organization`) and `server/mcp/__tests__/web-github-mcp-consistency.test.ts`.
- No service-role secrets, GitHub tokens, or internal IDs beyond the project's own stable UUID and display name are ever included in a tool response.

## 3. No auth bypass in production

- The MCP route has no development-mode bypass, no query-string override, and no alternate header that skips `resolveMcpAuth`. Both `GET` and `POST /api/mcp` call it unconditionally before doing anything else.
- The admin Supabase client (`createAdminClient()`) is only ever used *after* a valid API key has been resolved, and every subsequent query is still scoped by `organization_id` at the call site — the admin client's elevated privileges are not treated as an implicit authorization bypass.

## 4. Safe error responses

- All typed errors are `McpError { status, code, message, data? }`. `code` is always a stable, lowercase `snake_case` string from a fixed enum (see `docs/MCP_V1_IMPLEMENTATION.md` §8) — never a raw exception name or driver error code.
- `message` is always the localized, human-readable copy from `messages/{en,es}/mcp.json` — never a stack trace, SQL error, or internal file path.
- `data`, when present, is a small structured payload the client needs to recover (e.g. `ambiguous_project`'s `{ projects: [{ id, name, repositoryFullName }] }`) — never sensitive.
- Any error that is *not* an `McpError` (an unexpected exception) is caught in `app/api/mcp/route.ts` and downgraded to a generic `internal_error` with only `error.message` (never `error.stack`) surfaced — and only if it's an `Error` instance; anything else becomes the literal string `"Tool execution failed"`.
- `logMcpCall()` records `errorCode` for observability but never the underlying exception object, so a logging pipeline cannot leak a stack trace either.

## 5. Payload and abuse limits

- Request bodies over 64 KB are rejected with `413` before JSON parsing occurs (`MAX_REQUEST_BODY_BYTES`, checked against the `Content-Length` header).
- The parsed body is validated against `mcpPostBodySchema` (Zod) before use — malformed JSON or an unexpected shape is rejected with a generic `400`, not passed through to tool dispatch.
- Both `GET` and `POST /api/mcp` are rate-limited per client IP (`enforceRateLimit`, `keyPrefix: "mcp"`), returning `429` with a typed `rate_limited` body once the limit is exceeded within the rolling window. This applies **before** authentication is resolved, so it also protects the auth lookup itself from brute-force key guessing.
- `production_history`'s recent-verdict timeline is hard-capped at 20 rows regardless of the caller-supplied `limit`.
- `maxDuration = 60` seconds bounds worst-case handler execution on the hosting platform.

## 6. What MCP tools cannot do (by construction)

- **Cannot trigger a repository scan.** `can_i_deploy`, `what_changed`, and `production_history` read persisted rows (`production_verdicts`, `repository_scan_state`). `review_now` and `full_product_audit` enqueue reviews through existing server paths. `safe_fix` only reads persisted findings/priorities and returns a prompt — it never writes code or opens PRs.
- **Verdict source tagging:** remote tools that expose Production Verdict data include `source: "github"` or `source: "pr"`. Local stdio tools include `source: "local"`. `discover_application`, `cancel_review`, and `authorize_dynamic_target` omit source when no verdict applies.
- **Authoritative deploy answer:** `can_i_deploy` uses the **persisted** Production Verdict as authoritative; live recompute is exposed only as optional divergence metadata (`consistency`, `liveVerdictStatus`).
- **GitHub App (Phase D.3):** When configured, `resolveGitHubCredential()` prefers installation tokens over OAuth legacy. Installation tokens are ephemeral (in-memory cache only). Separate webhook secrets: `GITHUB_WEBHOOK_SECRET` (legacy) vs `GITHUB_APP_WEBHOOK_SECRET` (App). See `docs/GITHUB_APP_MIGRATION.md`.
- **Cannot modify files, execute commands, or create commits/PRs.** `safe_fix` returns a prompt as *text* for the caller's own AI coding agent to act on; the MCP server itself has no filesystem or git write path.
- **Cannot expose detected secrets or raw source content.** `safe_fix` evidence is limited to file paths (and optionally line numbers), never file contents; findings queries never `select` a raw code snippet column.
- **Cannot calculate a second verdict, score, or confidence number.** See `docs/ADR_001_SINGLE_SOURCE_OF_TRUTH.md` — this is a security property too, since a second, uncontrolled calculation path would be a second attack surface for producing misleading "safe to deploy" signals.

## 7. Observability without leakage

`logMcpCall()` is an explicit allow-list of fields (tool, organizationId, projectId, durationMs, result, errorCode, clientName) — there is no generic "log the request" call anywhere in the MCP code path that could accidentally capture headers or bodies. See `docs/MCP_V1_IMPLEMENTATION.md` §12 for the full field list and the never-log list.

## 8. Known limitations / accepted risk for private beta

- Rate limiting is in-memory per server instance (`server/http/rate-limit.ts`), not a shared/distributed limiter. On a multi-instance deployment this means the effective limit is `limit × instance count`. Acceptable for private beta traffic volumes; should move to a shared store (e.g. Redis) before public beta if abuse is observed.
- The rate-limit response on `/api/mcp` is issued **before** locale resolution (which requires a valid API key), so its error message is always English even when the caller's profile locale is Spanish. This is a deliberate trade-off: resolving locale would require authenticating first, defeating the purpose of rate-limiting the auth lookup itself.
- There is no repository-diff-evidence system wired to MCP yet, which is why `what_changed.confirmedIntroducedBlockers` is always empty (see `docs/MCP_V1_IMPLEMENTATION.md` §5). This is a correctness/trust decision, not a security gap, but is noted here because it bounds what MCP can honestly claim about causality.

## 9. OAuth 2.1 (Fase C — remote MCP)

Remote MCP now supports **OAuth 2.1 + PKCE S256** alongside legacy `seq_live_*` API keys.

- **Dual auth:** `resolveMcpAuth()` accepts `Bearer seq_live_*` (legacy, all scopes) or `Bearer seq_oat_*` (OAuth, scoped).
- **Discovery:** `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`.
- **Tokens:** opaque access tokens (`seq_oat_*`), hashed at rest; refresh tokens (`seq_ort_*`) with rotation and family revocation on reuse.
- **Scopes:** enforced centrally via `assertToolScope()` — see `docs/MCP_OAUTH.md`.
- **Tenant isolation:** OAuth tokens bind `organization_id` at issuance; project resolution unchanged.
- **Local MCP:** unchanged — stdio bridge does not use OAuth in Fase C.

Full OAuth documentation: `docs/MCP_OAUTH.md`.
