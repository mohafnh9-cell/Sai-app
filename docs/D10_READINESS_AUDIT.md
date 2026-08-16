# D.10 Readiness Audit

**Date:** 2026-08-14  
**Scope:** Private Beta staging E2E prerequisites  
**Rule:** No PASS without real evidence. No simulated E2E.

---

## Summary

| Area | Status | Blocker? |
|------|--------|----------|
| Code (D.1–D.9) | **PASS** (unit/regression) | No |
| Local environment | **BLOCKED** | Yes — no GitHub App, no staging URL |
| Vercel deployment | **PARTIAL** | Yes — Production only; no `GITHUB_APP_*` env |
| Supabase / migrations | **NOT VERIFIED** | Yes — DB host unreachable from audit environment |
| GitHub App (real) | **NOT VERIFIED** | Yes — not registered / not configured |
| Staging E2E | **NOT VERIFIED** | Yes — external dependency required |

**Verdict:** Cannot proceed to STAGING GO from this environment. All live E2E phases (3–13) are **NOT VERIFIED — EXTERNAL DEPENDENCY REQUIRED**.

---

## Area-by-area audit

### GitHub App infrastructure

| AREA | STATUS | EVIDENCE | RISK | REQUIRED ACTION |
|------|--------|----------|------|-----------------|
| GitHub App code (`server/github-app/*`) | **IMPLEMENTED** | Modules present; D.3.11 unit tests pass | Low | None for code |
| GitHub App registered on GitHub | **NOT VERIFIED** | `gh api /apps` → HTTP 404; no App owned by authenticated user | **HIGH** | Register staging App per `docs/GITHUB_APP_STAGING_RUNBOOK.md` §1 |
| `GITHUB_APP_ID` | **BLOCKED** | Not in `.env.local`; not in Vercel env list | **HIGH** | Add to staging/preview Vercel env |
| `GITHUB_APP_PRIVATE_KEY` | **BLOCKED** | Not in `.env.local`; not in Vercel env list | **HIGH** | Add to staging/preview Vercel env |
| `GITHUB_APP_WEBHOOK_SECRET` | **BLOCKED** | `validate-env.mjs`: `[not set]` locally; not on Vercel | **HIGH** | Add to staging/preview Vercel env |
| `GITHUB_APP_SLUG` | **BLOCKED** | Not configured anywhere observed | **HIGH** | Add after App creation |
| App webhook route | **IMPLEMENTED** | `app/api/webhooks/github-app/route.ts` | Low | Point App webhook to **staging** URL after deploy |
| Install / setup routes | **IMPLEMENTED** | `app/api/github/app/*` | Low | E2E after App exists |

### Deployment

| AREA | STATUS | EVIDENCE | RISK | REQUIRED ACTION |
|------|--------|----------|------|-----------------|
| Staging deployment | **NOT VERIFIED** | No `STAGING_BASE_URL` in env; `validate-env.mjs --staging` fails | **HIGH** | Create dedicated staging project or Preview env with stable URL |
| Production Vercel deploy | **PARTIAL** | `vercel ls`: 2 Production deployments (~17h ago), project `typebeats-projects/sequrai-app` | **MEDIUM** | Do **not** use Production for E2E experiments (runbook forbids) |
| `NEXT_PUBLIC_APP_URL` (local) | **PARTIAL** | `.env.local`: `http://localhost:3000` | Low | Expected for local dev |
| Preview env vars | **PARTIAL** | Vercel: Supabase, GitHub OAuth webhook secret, encryption key on Preview | Medium | Add `GITHUB_APP_*` to Preview when App ready |

### Database (migrations 050/051)

| AREA | STATUS | EVIDENCE | RISK | REQUIRED ACTION |
|------|--------|----------|------|-----------------|
| Migration 050 SQL in repo | **IMPLEMENTED** | `database/migrations/050_phase_d_github_app_pr_security.sql` | Low | Apply on staging Supabase |
| Migration 051 SQL in repo | **IMPLEMENTED** | `database/migrations/051_github_app_installation_security.sql` | Low | Apply on staging Supabase |
| Applied on connected Supabase | **NOT VERIFIED** | Read-only connect to `DATABASE_URL` host failed: `getaddrinfo ENOTFOUND db.*.supabase.co` | **HIGH** | Verify Supabase project active; run migration check SQL from runbook §3 |
| `github_app_installations` table | **NOT VERIFIED** | Could not connect | **HIGH** | Confirm after migration apply |
| `projects.github_auth_mode` | **NOT VERIFIED** | Could not connect | **HIGH** | Confirm after migration apply |
| `pull_request_scans` Check Run cols | **NOT VERIFIED** | Could not connect | Medium | Confirm `github_check_run_id`, `production_verdict_id`, `verdict_status` |

### OAuth legacy (dual-mode)

| AREA | STATUS | EVIDENCE | RISK | REQUIRED ACTION |
|------|--------|----------|------|-----------------|
| OAuth encryption key (local) | **PASS** | `GITHUB_TOKEN_ENCRYPTION_KEY`: `[set, length=44]` via validate-env | Low | Ensure same on staging |
| OAuth webhook secret (local) | **PASS** | `GITHUB_WEBHOOK_SECRET`: `[set]` | Low | Legacy repos still need this |
| `oauth_legacy` rollback (code) | **PASS** | D.3.11 `shouldPreferGitHubApp()` + unit tests | Low | Staging E2E rollback test still required |
| OAuth rollback (live) | **NOT VERIFIED** | No staging project with App mode | **HIGH** | Runbook §9 after App connect |

### Scan / verdict pipeline (code)

| AREA | STATUS | EVIDENCE | RISK | REQUIRED ACTION |
|------|--------|----------|------|-----------------|
| Webhook orchestrator | **IMPLEMENTED** | `server/github-automation/orchestrator.ts` | Low | Live webhook test pending |
| Canonical Production Verdict | **IMPLEMENTED** | Single engine: `brain/production-verdict/engine.ts` | Low | Confirm in E2E via persisted row |
| Check Run poster | **IMPLEMENTED** | `server/github-automation/github-check-run.ts` | Low | Live Check Run pending |
| PR incremental scans | **IMPLEMENTED** | `pull_request_scans` + orchestrator PR path | Low | Live PR test pending |
| Stale SHA (CI) | **PASS** (unit) | D.9: `stale=true` → `checkRun.conclusion=neutral` | Low | Live stale test (Phase 6) still required |

### CI/CD (D.8–D.9)

| AREA | STATUS | EVIDENCE | RISK | REQUIRED ACTION |
|------|--------|----------|------|-----------------|
| `GET /ci/status` | **IMPLEMENTED** | Route + 29 unit tests in `server/ci/__tests__` | Low | Live poll with MCP API key |
| `POST /ci/scan` | **IMPLEMENTED** | Idempotent ensure; PR → `awaiting_webhook` | Low | Live Actions workflow |
| GitHub Actions template | **IMPLEMENTED** | `examples/github-actions/sequrai-production-verdict.yml` | Low | Copy to test repo + secrets |
| CI E2E | **NOT VERIFIED** | No `SEQURAI_API_KEY` workflow run observed | **HIGH** | Configure secrets on test repo |

### D.7 correlation

| AREA | STATUS | EVIDENCE | RISK | REQUIRED ACTION |
|------|--------|----------|------|-----------------|
| Correlation engine | **IMPLEMENTED** | `lib/correlation/*`, D.7 unit tests | Low | Live correlation E2E pending |
| `correlationKey` on findings | **IMPLEMENTED** | Scanner + local analysis | Low | Match same commit SHA in E2E |

### Security / tenant isolation

| AREA | STATUS | EVIDENCE | RISK | REQUIRED ACTION |
|------|--------|----------|------|-----------------|
| Tenant isolation (unit) | **PASS** | `ci-access.test.ts`, `tenant-isolation.test.ts` | Low | Two-workspace live test pending |
| Webhook HMAC (code) | **IMPLEMENTED** | App + legacy webhook routes | Low | Invalid signature live test pending |
| Secret logging | **PASS** (code review) | validate-env never prints values; CI logs use metadata only | Low | Spot-check staging logs during E2E |

### Test / build gates

| AREA | STATUS | EVIDENCE | RISK | REQUIRED ACTION |
|------|--------|----------|------|-----------------|
| `npm run test:release` | **PASS** | 1069 passed, 2 failed (environmental) | Low | See failures below |
| `npm run lint` | **PASS** | 0 errors, 4 pre-existing warnings | Low | None |
| `npm run build` | **PASS** | Build completed successfully | Low | None |
| Typecheck (full repo) | **PARTIAL** | Pre-existing TS errors in unrelated test files (D.9 noted) | Low | Not blocking CI module |

**Environmental test failures (PRE-EXISTING):**  
`lib/local-analysis/__tests__/local-verdict.test.ts` — `git init` fails in sandbox (2 tests). Not D.10-related.

---

## Environment validation (Phase 1)

### Present locally (names only — no values)

| Variable | Local |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | set |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | set |
| `SUPABASE_SERVICE_ROLE_KEY` | set |
| `DATABASE_URL` | set (host unreachable) |
| `GITHUB_WEBHOOK_SECRET` | set |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | set |
| `NEXT_PUBLIC_APP_URL` | set (`localhost:3000`) |

### Missing for staging E2E

| Variable | Required for |
|----------|--------------|
| `GITHUB_APP_ID` | App JWT, installation tokens |
| `GITHUB_APP_PRIVATE_KEY` | App authentication |
| `GITHUB_APP_WEBHOOK_SECRET` | App webhook HMAC |
| `GITHUB_APP_SLUG` | Install URL |
| `STAGING_BASE_URL` | Staging validation script |
| `INTERNAL_OPS_TOKEN` | Ops health (validate-env staging) |
| `GITHUB_APP_STATE_SECRET` | Recommended install CSRF |

### Present on Vercel (names only — from `vercel env ls`)

Preview + Production: Supabase, `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN_ENCRYPTION_KEY`, Stripe keys.  
**No `GITHUB_APP_*` variables on Vercel.**

---

## E2E phases — execution status

| Phase | Description | Status | Reason |
|-------|-------------|--------|--------|
| 0 | Audit | **PASS** | This document |
| 1 | Environment | **FAIL** | Missing App + staging vars |
| 2 | Database | **NOT VERIFIED** | Supabase unreachable |
| 3 | GitHub App install | **NOT VERIFIED** | No App configured |
| 4 | Push → verdict | **NOT VERIFIED** | Depends on 3 |
| 5 | PR E2E | **NOT VERIFIED** | Depends on 4 |
| 6 | Stale SHA (live) | **NOT VERIFIED** | Depends on 5 |
| 7 | CI/CD workflow | **NOT VERIFIED** | No live Actions run |
| 8 | Idempotency (live) | **NOT VERIFIED** | Depends on 4+7 |
| 9 | OAuth rollback (live) | **NOT VERIFIED** | Depends on 3 |
| 10 | Tenant isolation (live) | **NOT VERIFIED** | Needs 2 workspaces |
| 11 | Correlation E2E | **NOT VERIFIED** | Depends on 4 |
| 12 | Webhook security (live) | **NOT VERIFIED** | Depends on deployed webhook |
| 13 | Installation lifecycle | **NOT VERIFIED** | Depends on 3 |

---

## Minimal change plan

**No product code changes recommended** until staging infrastructure exists. Blockers are operational, not architectural.

1. Register staging GitHub App
2. Apply migrations 050/051 on active Supabase
3. Deploy staging with full `GITHUB_APP_*` + existing Supabase/OAuth vars
4. Execute runbook + D.10 phases 3–13 with evidence capture
5. Update `docs/D10_PRIVATE_BETA_GO_GATE.md` with PASS/FAIL per gate

---

## Composite action / new features

**No new code** for D.10. D.9 decision stands: YAML template only, no composite action until customer demand.
