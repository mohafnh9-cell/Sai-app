# D.3.11 Final GO Gate

Last updated from local verification session. **Do not mark PASS without evidence.**

Legend: **PASS** = verified with evidence | **FAIL** = verified failure | **NOT VERIFIED** = not tested / external dependency missing

---

## 1. Code readiness

| Check | Status | Evidence |
|-------|--------|----------|
| GitHub App modules present | **PASS** | `server/github-app/*` |
| Unified credential provider | **PASS** | `resolveGitHubCredential()` |
| Explicit `oauth_legacy` never uses App | **PASS** | `shouldPreferGitHubApp()` + unit tests |
| Explicit `github_app` fail closed | **PASS** | credential-provider tests |
| Installation flow routes | **PASS** | `/api/github/app/{install,setup,status,repos}` |
| App webhook route | **PASS** | `/api/webhooks/github-app` |
| Dual webhook secrets | **PASS** | separate env vars |
| Canonical Production Verdict engine | **PASS** | `brain/production-verdict/engine.ts` |
| PR Check Run integration | **PASS** | `github-check-run.ts` + tests |
| Local MCP boundary | **PASS** | `resolveAuthorizedWorkspacePath` + isolation test |
| `npm run test:release` | **PASS** | see test section below |

**CODE GO:** **YES** (pending current test run)

---

## 2. Local verification

| Check | Status | Evidence |
|-------|--------|----------|
| Credential provider unit tests (8 cases) | **PASS** | `credential-provider.test.ts` |
| Tenant isolation unit tests | **PASS** | `tenant-isolation.test.ts` |
| JWT / permissions tests | **PASS** | `github-app-core.test.ts` |
| Check Run mapping tests | **PASS** | `github-check-run.test.ts` |
| Local/GitHub App isolation | **PASS** | `github-app-isolation.test.ts` |
| Integrations UI App repo discovery | **PASS** | uses `/api/github/app/repos` when App active |

---

## 3. GitHub App verification (staging/production)

| Check | Status | Evidence |
|-------|--------|----------|
| GitHub App registered | **NOT VERIFIED** | No `GITHUB_APP_*` in local env |
| Install flow E2E | **NOT VERIFIED** | Requires registered App + staging URL |
| Installation token from GitHub API | **NOT VERIFIED** | No live App credentials |
| Permission set on real App | **NOT VERIFIED** | Manual GitHub App setup required |

---

## 4. Database verification

| Check | Status | Evidence |
|-------|--------|----------|
| Migration 050 syntax / idempotency | **PASS** | SQL reviewed locally |
| Migration 051 syntax / idempotency | **PASS** | SQL reviewed locally |
| Applied in local Supabase | **NOT VERIFIED** | No DB access evidence |
| Applied in staging Supabase | **NOT VERIFIED** | — |
| Applied in production Supabase | **NOT VERIFIED** | — |

---

## 5. Webhook verification

| Check | Status | Evidence |
|-------|--------|----------|
| HMAC verification (code) | **PASS** | `app/api/webhooks/github-app/route.ts` |
| Delivery dedup (code) | **PASS** | `delivery-idempotency.ts` |
| Real GitHub delivery to staging | **NOT VERIFIED** | No public staging + App webhook |
| push → scan job E2E | **NOT VERIFIED** | — |

---

## 6. PR verification

| Check | Status | Evidence |
|-------|--------|----------|
| PR pipeline code path | **PASS** | orchestrator → scan → verdict |
| Real PR webhook → scan | **NOT VERIFIED** | — |
| Stale SHA / new head rescan | **NOT VERIFIED** | — |

---

## 7. Check Run verification

| Check | Status | Evidence |
|-------|--------|----------|
| Name `SequrAI — Production Verdict` | **PASS** | constant in code |
| Mapping unit tests | **PASS** | `github-check-run.test.ts` |
| Live Check Run on GitHub PR | **NOT VERIFIED** | — |

---

## 8. Tenant verification

| Check | Status | Evidence |
|-------|--------|----------|
| Cross-org installation (unit) | **PASS** | tests |
| Two-workspace E2E | **NOT VERIFIED** | — |

---

## 9. OAuth rollback verification

| Check | Status | Evidence |
|-------|--------|----------|
| `oauth_legacy` forces OAuth (code) | **PASS** | D.3.11 fix + tests |
| Staging rollback E2E | **NOT VERIFIED** | Runbook §9 |

---

## 10. Production readiness

| Check | Status |
|-------|--------|
| Staging E2E complete | **NOT VERIFIED** |
| Production App registered | **NOT VERIFIED** |
| Production env vars set | **NOT VERIFIED** |
| Migrations applied in production | **NOT VERIFIED** |
| Rollback tested in staging | **NOT VERIFIED** |

---

## Gate summary

| Gate | Verdict |
|------|---------|
| **CODE GO** | **GO** — architecture + unit/regression tests |
| **STAGING GO** | **NO-GO** — no live GitHub App E2E |
| **PRODUCTION GO** | **NO-GO** — staging not validated |

---

## Next actions

1. Register staging GitHub App (see `docs/GITHUB_APP_STAGING_RUNBOOK.md`)
2. Apply migrations 050 + 051 on staging Supabase
3. Configure `GITHUB_APP_*` on staging deployment
4. Execute runbook steps 4–10 including rollback test
5. Re-fill this document with PASS/NOT VERIFIED from real evidence
6. Only then evaluate **STAGING GO** → **PRODUCTION GO**
