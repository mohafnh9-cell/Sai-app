# GitHub App Migration (Phase D.3)

SequrAI is migrating from **Supabase GitHub OAuth** (broad user token) to a **GitHub App** (least privilege, installation-scoped tokens).

Both modes coexist until migration is validated in production.

## Auth mode semantics (D.3.11)

| `projects.github_auth_mode` | Behavior |
|-----------------------------|----------|
| `github_app` | **Only** GitHub App installation token. Fail closed if App cannot authenticate. No OAuth fallback. |
| `oauth_legacy` | **Only** encrypted OAuth token. Never attempts GitHub App, even when App is globally configured. |
| `null` / unset | Default policy: prefer GitHub App when `isGitHubAppConfigured()` and installation exists; otherwise OAuth legacy. |

Rollback: set `github_auth_mode = 'oauth_legacy'` on a project to force OAuth without disabling the App for other projects.

## Architecture

```
SequrAI
   │
   ├─ github_app (preferred when configured + installed)
   │      └─ installation access token (short-lived, in-memory cache only)
   │
   └─ oauth_legacy (fallback)
          └─ workspace_github_connections encrypted OAuth token
                │
                ▼
      resolveGitHubCredential()  →  resolveOrganizationGitHubToken()
                │
                ▼
         GitHubRepositoryService / scanners / Check Runs
                │
                ▼
      brain/production-verdict/engine.ts  (unchanged)
```

## Permissions (justified)

| Permission | Level | Why |
|------------|-------|-----|
| Contents | Read | Fetch repository files for static analysis |
| Metadata | Read | Resolve repository identity and default branch |
| Pull requests | Read | PR incremental scans |
| Commit statuses | Write | Legacy commit status (OAuth path) |
| Checks | Write | PR Check Run **SequrAI — Production Verdict** |
| Webhooks | Write | Legacy per-repo webhook registration (OAuth path only) |

**Not requested:** Contents Write, Pull requests Write, Issues Write, Administration, Secrets, Members.

GitHub App installations receive App-level webhooks at `/api/webhooks/github-app` — per-repo OAuth webhooks are skipped for `github_auth_mode = github_app` projects.

## Environment variables (server-only)

| Variable | Purpose |
|----------|---------|
| `GITHUB_APP_ID` | GitHub App ID (JWT `iss`) |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key (never commit) |
| `GITHUB_APP_WEBHOOK_SECRET` | HMAC secret for App webhooks |
| `GITHUB_APP_SLUG` | App slug for install URL |
| `GITHUB_APP_CLIENT_ID` | Optional (user-to-server flows) |
| `GITHUB_APP_CLIENT_SECRET` | Optional |
| `GITHUB_APP_STATE_SECRET` | Install state signing (falls back to OAuth state secret) |

Legacy OAuth continues to use:

- `GITHUB_WEBHOOK_SECRET` → `/api/webhooks/github` (repo hooks)
- `GITHUB_TOKEN_ENCRYPTION_KEY` → encrypted OAuth tokens

## Installation flow

1. Workspace owner calls `GET /api/github/app/install` → redirect to GitHub App install page
2. GitHub redirects to `GET /api/github/app/setup?installation_id=…&state=…`
3. SequrAI verifies signed state + workspace membership
4. Fetches installation + repositories from GitHub API
5. Stores `github_app_installations` + `github_app_installation_repositories`
6. User connects repos via existing `/api/github/connect` (App token + ownership verification)

## Token lifecycle

- **App JWT:** RS256, 10-minute max TTL, 60s clock skew on `iat`
- **Installation token:** fetched from GitHub, cached in memory until ~60s before expiry
- **Never persisted** to database or logs
- **OAuth tokens:** unchanged (encrypted at rest)

## Webhook lifecycle

| Endpoint | Secret | Source |
|----------|--------|--------|
| `/api/webhooks/github` | `GITHUB_WEBHOOK_SECRET` | OAuth legacy repo hooks |
| `/api/webhooks/github-app` | `GITHUB_APP_WEBHOOK_SECRET` | GitHub App |

App webhook events:

- `installation` / `installation_repositories` → installation store
- Repository events (`push`, `pull_request`, …) → existing orchestrator (by `github_repository_id`)

Delivery deduplication unchanged (`github_delivery_id`).

## Repository lifecycle

- **Rename:** existing orchestrator updates `github_repo` metadata (ID stable)
- **Transfer:** fail-closed — `connection_issue`, no cross-tenant auto-move
- **Delete:** disable webhook/connection, preserve verdict history
- **Installation deleted:** mark installation revoked, reset affected projects to OAuth mode fields

## Rollback

Set workspace/projects back to `oauth_legacy`:

1. Disconnect GitHub App in GitHub settings (optional)
2. Ensure OAuth workspace connection is active
3. Reconnect repositories — OAuth path re-registers repo webhooks

No project or verdict data is deleted during App install/uninstall.

## Production setup checklist

1. Create GitHub App with permissions above
2. Set webhook URL to `https://<app>/api/webhooks/github-app`
3. Set setup URL to `https://<app>/api/github/app/setup`
4. Apply migrations `050` + `051`
5. Configure env vars in Vercel (never in git)
6. Install App on a staging org and verify: install → connect → push → PR Check Run

## Status labels

| Capability | Status |
|------------|--------|
| Dual-mode credential provider | **IMPLEMENTED** |
| Installation flow API | **IMPLEMENTED** (requires live App + env) |
| App webhooks | **IMPLEMENTED** (requires live App + env) |
| E2E verified in production | **NOT VERIFIED** |
| OAuth legacy removal | **NOT IMPLEMENTED** (intentional) |
