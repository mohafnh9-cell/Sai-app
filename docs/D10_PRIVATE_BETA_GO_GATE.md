# D.10 Private Beta GO Gate

**Date:** 2026-08-14  
**Purpose:** Gate Private Beta readiness after live staging E2E  
**Rule:** STAGING GO only if all **CRITICAL/HIGH** gates PASS with real evidence.

Legend: **PASS** | **FAIL** | **NOT VERIFIED** | **BLOCKED**

---

## Gate table

| Gate | Status | Evidence | Risk | Blocker |
|------|--------|----------|------|---------|
| **GitHub App installation E2E** | **NOT VERIFIED** | No `GITHUB_APP_*` in local or Vercel env; `gh api /apps` → 404 | **CRITICAL** | Yes |
| **Repository connection** | **NOT VERIFIED** | Requires App install + DB | **CRITICAL** | Yes |
| **Push scan** | **NOT VERIFIED** | No live webhook delivery observed | **CRITICAL** | Yes |
| **Production Verdict (persisted)** | **NOT VERIFIED** | Code: `brain/production-verdict/engine.ts`; no live row | **CRITICAL** | Yes |
| **Check Run** | **NOT VERIFIED** | Code + unit tests; no live GitHub Check Run | **CRITICAL** | Yes |
| **PR scan** | **NOT VERIFIED** | Orchestrator code present; no live PR | **CRITICAL** | Yes |
| **CI/CD (Actions workflow)** | **NOT VERIFIED** | Template exists; no workflow run with secrets | **HIGH** | Yes |
| **Stale SHA (live)** | **NOT VERIFIED** | Unit test PASS (D.9); live A→B test not run | **CRITICAL** | Yes |
| **Idempotency (live)** | **NOT VERIFIED** | Unit tests PASS; webhook+CI live test not run | **HIGH** | Yes |
| **OAuth rollback (live)** | **NOT VERIFIED** | Code PASS (D.3.11); staging SQL rollback not run | **CRITICAL** | Yes |
| **Tenant isolation (live)** | **NOT VERIFIED** | Unit tests PASS; two-workspace E2E not run | **CRITICAL** | Yes |
| **Webhook HMAC (live)** | **NOT VERIFIED** | Code present; invalid signature not sent to live URL | **HIGH** | Yes |
| **Installation lifecycle** | **NOT VERIFIED** | Code present; revoke/rename/transfer not tested live | **HIGH** | Yes |
| **Local ↔ GitHub correlation** | **NOT VERIFIED** | D.7 code + tests; no live same-SHA correlation | **HIGH** | Yes |
| **Migrations 050/051 applied** | **NOT VERIFIED** | SQL in repo; Supabase connect failed (ENOTFOUND) | **CRITICAL** | Yes |
| **build** | **PASS** | `npm run build` succeeded 2026-08-14 | Low | No |
| **lint** | **PASS** | 0 errors (4 pre-existing warnings) | Low | No |
| **release tests** | **PASS** | 1069 passed; 2 ENV failures (`local-verdict.test.ts` git init) | Low | No |
| **typecheck** | **PARTIAL** | Pre-existing errors in unrelated test files; CI module clean | Low | No |

---

## Infrastructure checklist (must complete before re-running gates)

### GitHub

- [ ] Create **staging** GitHub App (separate from future production App)
- [ ] Permissions: Contents/Metadata/PR read; Commit statuses + Checks read/write; Webhooks read/write
- [ ] Webhook URL: `https://<STAGING_HOST>/api/webhooks/github-app`
- [ ] Install App on test org/account with one test repository

### Vercel / deployment

- [ ] Staging or stable Preview URL (set `STAGING_BASE_URL`)
- [ ] Add env vars: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_SLUG`
- [ ] Optional: `GITHUB_APP_STATE_SECRET`, `INTERNAL_OPS_TOKEN`
- [ ] Confirm `NEXT_PUBLIC_APP_URL` matches staging host

### Supabase

- [ ] Confirm project active (resolve DB host ENOTFOUND if paused/deleted)
- [ ] Apply `050_phase_d_github_app_pr_security.sql`
- [ ] Apply `051_github_app_installation_security.sql`
- [ ] Verify columns per runbook §3 SQL

### Test repository

- [ ] Connect repo in SequrAI Integrations → confirm `github_auth_mode=github_app`
- [ ] Create MCP API key for CI (`seq_live_…`)
- [ ] Add GitHub Actions secrets: `SEQURAI_API_KEY`, `SEQURAI_PROJECT_ID`, `SEQURAI_BASE_URL`
- [ ] Copy `examples/github-actions/sequrai-production-verdict.yml`

---

## Mandatory live test script (execute after infrastructure ready)

Record evidence (HTTP status, row IDs, Check Run URL, **no secrets**) for each step.

1. **Install App** → Integrations → verify `github_app_installations` row  
2. **Connect repo** → verify `projects.github_auth_mode='github_app'`  
3. **Push commit A** → verify `repository_events`, `scan_jobs`, `production_verdicts`  
4. **Verify Check Run** on commit A SHA  
5. **Open PR** → verify `pull_request_scans` + Check Run on head SHA  
6. **Push commit B on PR** → query CI status for A → **`stale=true`**, conclusion **≠ success**  
7. **Query CI status for B** → pending until scan completes  
8. **Run GitHub Actions workflow** → poll `/ci/status` until terminal conclusion  
9. **Duplicate trigger** → push webhook + `POST /ci/scan` same SHA → one effective scan  
10. **Rollback** → `UPDATE projects SET github_auth_mode='oauth_legacy'` → scan must use OAuth only  
11. **Restore App mode** → scan must use App again  
12. **Tenant test** → workspace B token cannot read/trigger workspace A project (404/401)  
13. **Correlation** → local audit at SHA + `POST /local-correlation` → matched/unmatched with evidence  
14. **Webhook security** → invalid HMAC → 401, no scan created  
15. **Invalid signature / duplicate delivery** → fail closed per runbook §10  

---

## Gate summary

| Gate | Verdict |
|------|---------|
| **CODE GO** | **GO** — D.1–D.9 implemented; 1069 release tests pass |
| **STAGING GO** | **NO-GO** — zero live E2E evidence |
| **PRIVATE BETA READY** | **NO-GO** — blocked on STAGING GO |

---

## Private Beta readiness criteria (for future PASS)

All must be true:

- [ ] STAGING GO (all CRITICAL/HIGH gates PASS)
- [ ] No unresolved critical security issue
- [ ] No known cross-tenant data leak
- [ ] Stale SHA never returns `success` (live + unit)
- [ ] OAuth rollback verified live
- [ ] Onboarding path works: signup → connect repo → first verdict → Check Run visible

---

## Exact next step

**Operational (no code):**

1. Fix or confirm Supabase project (`DATABASE_URL` host must resolve)
2. Register staging GitHub App + add four `GITHUB_APP_*` vars to Vercel Preview/staging
3. Apply migrations 050/051
4. Execute mandatory live test script above
5. Re-fill this document with PASS evidence and timestamps

**Do not** run E2E experiments on Production Vercel deployments (`sequrai-*-typebeats-projects.vercel.app`) per staging runbook.
