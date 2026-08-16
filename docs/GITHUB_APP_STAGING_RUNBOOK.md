# GitHub App — Staging E2E Runbook (D.3.11)

Use this runbook to validate Phase D.3 GitHub App dual-mode auth in a **staging** environment only. Do not use production as an experiment.

**Status when this document was written:** Live E2E was **NOT VERIFIED** from the development environment (no `GITHUB_APP_*` env vars, no registered App, migrations not confirmed applied).

---

## 1. GitHub App creation (staging)

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**
2. Name: e.g. `SequrAI Staging`
3. Homepage URL: staging app URL (e.g. `https://staging.sequrai.example`)
4. Callback URL: not required for installation-only flow (install uses `/api/github/app/setup`)
5. **Setup URL (optional):** `https://<STAGING_HOST>/api/github/app/setup`
6. **Webhook URL:** `https://<STAGING_HOST>/api/webhooks/github-app`
7. **Webhook secret:** generate a strong random value → store as `GITHUB_APP_WEBHOOK_SECRET`
8. **Repository permissions** (least privilege — match `GITHUB_APP_TARGET_PERMISSIONS` in code):

   | Permission | Access |
   |------------|--------|
   | Contents | Read |
   | Metadata | Read |
   | Pull requests | Read |
   | Commit statuses | Read and write |
   | Checks | Read and write |
   | Webhooks | Read and write |

   Do **not** grant write access to Contents, Pull requests, Issues, Administration, Secrets, or Members.

9. **Subscribe to events:** `push`, `pull_request`, `delete`, `repository`, `installation`, `installation_repositories`
10. Where can this GitHub App be installed? → **Any account** (or restrict to staging org)
11. Create App → note **App ID** and **Client ID** (optional)
12. Generate a **private key** (PEM) → store as `GITHUB_APP_PRIVATE_KEY` (never commit)

---

## 2. Environment variables (staging / Vercel preview)

Server-only (never expose to client):

| Variable | Required | Purpose |
|----------|----------|---------|
| `GITHUB_APP_ID` | Yes | JWT `iss` |
| `GITHUB_APP_PRIVATE_KEY` | Yes | RS256 signing (PEM; `\n` escaped OK) |
| `GITHUB_APP_WEBHOOK_SECRET` | Yes | HMAC for `/api/webhooks/github-app` |
| `GITHUB_APP_SLUG` | Yes | Install URL slug |
| `GITHUB_APP_STATE_SECRET` | Recommended | Install CSRF state (falls back to OAuth state secret) |
| `GITHUB_APP_CLIENT_ID` | Optional | Future user-to-server flows |
| `GITHUB_APP_CLIENT_SECRET` | Optional | Future user-to-server flows |

Legacy (must remain for dual-mode):

| Variable | Purpose |
|----------|---------|
| `GITHUB_WEBHOOK_SECRET` | Legacy OAuth repo hooks → `/api/webhooks/github` |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Encrypted OAuth tokens |
| `NEXT_PUBLIC_APP_URL` | Install redirect + webhook base URL |

Validate locally:

```bash
node scripts/validate-env.mjs --staging
```

Partial App config produces a **warning** (all four core vars required together).

---

## 3. Supabase migrations

Apply in order on **staging** Supabase (via SQL editor or migration pipeline):

1. `database/migrations/050_phase_d_github_app_pr_security.sql`
2. `database/migrations/051_github_app_installation_security.sql`

Verify columns exist:

```sql
-- installations
select column_name from information_schema.columns
  where table_name = 'github_app_installations';

-- project auth mode
select column_name from information_schema.columns
  where table_name = 'projects'
  and column_name in ('github_auth_mode', 'github_app_installation_id');

-- installation repos junction
select * from information_schema.tables
  where table_name = 'github_app_installation_repositories';
```

**Note:** Migrations 050/051 do not add RLS policies on App tables. Access is via service role (same pattern as other automation tables). Confirm no client-side Supabase queries target these tables.

---

## 4. Installation steps

1. Deploy staging with all env vars set.
2. Log in as workspace owner.
3. Open **Integrations** → **GitHub App (recommended)** card → **Install GitHub App**
   - Or: `GET /api/github/app/install` (redirects to GitHub)
4. On GitHub, select staging org/account and repositories.
5. GitHub redirects to `/api/github/app/setup?installation_id=…&state=…`
6. Confirm redirect to `/integrations?githubApp=installed&repoCount=N`
7. Verify DB:

```sql
select id, github_installation_id, github_account_login, status, revoked_at
  from github_app_installations
  where organization_id = '<workspace-org-id>';

select github_repository_id, github_full_name, removed_at
  from github_app_installation_repositories
  where organization_id = '<workspace-org-id>';
```

---

## 5. Repository connection

1. From Integrations, load repositories and connect a test repo.
   - App path: repos verified via installation token + `assertInstallationOwnsRepository`
   - Per-repo OAuth webhooks are **skipped** for App mode (`webhooksSkipped` in response)
2. Confirm project row:

```sql
select id, github_repository_id, github_auth_mode, github_app_installation_id, webhook_enabled
  from projects
  where github_repository_id = <repo_id>;
```

Expected: `github_auth_mode = 'github_app'`, `github_app_installation_id` set.

**Optional:** List App repos via `GET /api/github/app/repos` (UI currently uses `/api/github/repos` — both should work when App token resolves).

---

## 6. Scan verification

1. Trigger **full_product_audit** via MCP or dashboard for the connected project.
2. Confirm scan completes without OAuth reauth prompt.
3. Check logs for credential source (no tokens in logs):

   - `authSource: "github_app"` via token resolver (when logged at call sites)
   - No `installation_token` values in stdout

4. Verify persisted Production Verdict:

```sql
select id, status, project_id, commit_sha
  from production_verdicts
  where project_id = '<project-id>'
  order by created_at desc
  limit 1;
```

Engine must remain `brain/production-verdict/engine.ts` (no alternate scorer).

---

## 7. PR verification

1. Open a test PR on the connected repository.
2. Confirm GitHub delivers webhook to `/api/webhooks/github-app` (App-level webhook).
3. Verify incremental scan queued and `pull_request_scans` updated:

```sql
select pull_request_number, head_sha, verdict_status, github_check_run_id, production_verdict_id
  from pull_request_scans
  where project_id = '<project-id>'
  order by updated_at desc
  limit 5;
```

4. Push a new commit to the PR branch → confirm **new** head SHA gets a **new** scan/check (old SHA not overwritten).

---

## 8. Check Run verification

1. On the PR, find check: **SequrAI — Production Verdict**
2. Conclusion mapping (actual code in `verdictStatusToCheckConclusion`):

   | Verdict status | Check conclusion |
   |----------------|------------------|
   | `ready_to_ship` | `success` |
   | `not_ready` / `almost_ready` | `failure` |
   | `insufficient_data` | `action_required` (not `neutral`) |
   | `analysis_failed` | `failure` |
   | pending / scan missing | `neutral` |

3. Check output title should reflect GO/NO-GO from persisted verdict.

---

## 9. Rollback test (mandatory)

Goal: prove dual-mode works.

1. Pick staging project connected via App.
2. Set explicit legacy mode:

```sql
update projects
  set github_auth_mode = 'oauth_legacy',
      github_app_installation_id = null
  where id = '<project-id>';
```

3. Ensure workspace still has valid OAuth connection (`workspace_github_connections`).
4. Run scan + PR pipeline → must succeed via OAuth token.
5. Restore App mode:

```sql
update projects
  set github_auth_mode = 'github_app',
      github_app_installation_id = '<installation-row-id>'
  where id = '<project-id>';
```

6. Re-run scan → must use App again.

**Code behavior (D.3.11):** Explicit `oauth_legacy` on a project **never** attempts GitHub App, even when App is globally configured. Verified by unit tests in `credential-provider.test.ts`.

**Known prior risk (fixed):** Before D.3.11, global App config could override explicit `oauth_legacy`. Staging rollback must still be executed to confirm end-to-end.

---

## 10. Failure tests

| Scenario | Expected behavior |
|----------|-------------------|
| Revoked installation | `markInstallationRevoked`; credential resolution returns null for App mode projects |
| Repo removed from installation | `removed_at` set; connect/scan rejected |
| Repo transferred | `connection_issue`; fail closed; revalidation required |
| Repo deleted | webhook disables connection; history preserved |
| Repo renamed | metadata updated; `github_repository_id` unchanged |
| Invalid webhook signature | 401, no processing |
| Duplicate delivery ID | 202 duplicate (when recorded in `repository_events`) |
| Missing App env | Install returns 503; legacy OAuth continues |
| Invalid private key | JWT/signing fails; token fetch returns null; warn log without secrets |
| GitHub API 401/403 on token | `installation_token_failed` warn log (status only) |

---

## 11. Production readiness checklist

Before production GO:

- [ ] Staging E2E completed (install → connect → scan → PR → Check Run)
- [ ] Rollback test passed (oauth_legacy ↔ github_app)
- [ ] Migrations 050 + 051 applied in production Supabase
- [ ] Production GitHub App registered (separate from staging App)
- [ ] All `GITHUB_APP_*` env vars set in production
- [ ] App webhook URL points to production `/api/webhooks/github-app`
- [ ] Legacy `GITHUB_WEBHOOK_SECRET` still configured (existing OAuth repos)
- [ ] No tokens/private keys in logs during staging test
- [ ] Tenant isolation spot-check (two workspaces, two installations)
- [ ] `npm run test:release` green on release commit
- [ ] Documented any Check Run mapping differences vs product spec

---

## 12. Rollback strategy (production)

If App causes issues after rollout:

1. Do **not** delete installations or projects.
2. Per project: `update projects set github_auth_mode = 'oauth_legacy'`.
3. Ensure OAuth workspace connection is valid; re-register legacy repo webhooks if needed.
4. Disable or misconfigure App env vars only as last resort (disables install UI, not existing OAuth).

Historical `production_verdicts`, `scan_findings`, and PR history are preserved.

---

## 13. Observability (existing infra)

Log fields to watch (no credential values):

- `component: "github-app-token"`, `event: "installation_token_failed"`, `status`
- `component: "github-app-webhook"`, `event: "invalid_signature"`
- `authSource` on token resolver consumers (when instrumented)
- `github_connect_failed`, `github_check_run_post_failed` (status + sha, no token)

Compare App vs OAuth success rates manually from staging logs until dedicated metrics exist.
