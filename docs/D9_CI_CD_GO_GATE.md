# D.9 CI/CD GO Gate

Last updated from Phase D.9 verification session. **Do not mark PASS without evidence.**

Legend: **PASS** = verified with evidence | **FAIL** = verified failure | **NOT VERIFIED** = not tested / external dependency missing

---

## Gate table

| Gate | Status | Evidence |
|------|--------|----------|
| **CODE** | **PASS** | D.8 CI module `server/ci/*`, routes under `/api/projects/[id]/ci/*` |
| **TESTS** | **PASS** | `server/ci/__tests__/*` — see test section |
| **TYPECHECK** | **PASS** | No D.9-related TS errors in CI module (full repo has pre-existing unrelated errors) |
| **LINT** | **PASS** | 0 lint errors on D.9 files |
| **BUILD** | **PASS** | `npm run build` succeeds |
| **CI STATUS** | **PASS** | Unit tests: push SHA, PR SHA, missing, pending, failed, insufficient_data, stale |
| **CI SCAN** | **PASS** | Unit tests: first request, duplicate/reuse, PR awaiting_webhook, PR SHA mismatch |
| **IDEMPOTENCY** | **PASS** | `buildCiIdempotencyKey` tests + ensureCiScan reuse/resume without duplicate `scheduleScanRun` |
| **STALE SHA** | **PASS** | D.9 fix: `stale=true` forces `checkRun.conclusion=neutral` (never success); test in `ci-status.test.ts` |
| **DUPLICATE TRIGGER** | **PASS** | `ensure-ci-scan.test.ts`: webhook+CI same SHA → `resumed`, no `scheduleScanRun` |
| **CHECK RUN** | **PASS** | Contract tests in `ci-enforcement.test.ts` + `github-check-run.test.ts` |
| **D.7 CORRELATION** | **PASS** | `correlation.ready` gated on completed verdict + exact SHA + `!stale`; D.7 module unchanged |
| **TENANT ISOLATION** | **PASS** | `ci-access.test.ts` cross-tenant MCP rejection |
| **RATE LIMIT** | **PASS** | `enforceRateLimit` on both routes; `ci-routes.test.ts` 429 case |
| **ACTION TEMPLATE** | **PASS** | `examples/github-actions/sequrai-production-verdict.yml` audited: secrets, SHA, push/PR split, timeout, stale loop |
| **GITHUB APP E2E** | **NOT VERIFIED** | No `GITHUB_APP_*` in local `.env.local` |
| **PR E2E** | **NOT VERIFIED** | Requires staging GitHub App + webhook delivery |
| **ROLLBACK (oauth_legacy)** | **NOT VERIFIED** | Code PASS via D.3.11 tests; staging E2E not run |
| **OBSERVABILITY** | **PASS** | `logCiEvent` with `triggerSource: ci`, `authSource`, no token fields |

---

## Composite GitHub Action decision

**NOT IMPLEMENTED** (documented decision)

| Factor | Assessment |
|--------|------------|
| Complexity | Medium — packaging, versioning, marketplace maintenance |
| Value vs YAML | Low incremental value; existing YAML is copy-paste and auditable |
| Security | Action would need pinned SHA + secret handling review |
| Maintenance | Additional release surface |

**Conclusion:** Keep `examples/github-actions/sequrai-production-verdict.yml` as the supported integration path until customer demand justifies a composite action.

---

## Test matrix (D.9)

### CI Status
- [x] valid push SHA
- [x] valid PR SHA
- [x] missing SHA (route 400)
- [x] malformed SHA
- [x] stale SHA → neutral conclusion
- [x] pending → neutral
- [x] failed → not success
- [x] ready verdict → success
- [x] insufficient_data → action_required
- [x] cross-tenant (access layer)

### CI Scan
- [x] first request (schedule)
- [x] duplicate request (reuse)
- [x] concurrent duplicate (23505 path — code review; insert conflict handler)
- [x] PR awaiting webhook
- [x] cross tenant
- [x] unauthorized (401 route test)

### Check Run
- [x] ready_to_ship → success
- [x] not_ready → failure
- [x] almost_ready → failure
- [x] insufficient_data → action_required
- [x] pending → neutral
- [x] stale → neutral (D.9 hardening)

### Correlation
- [x] matching commit (`correlation.ready=true` when completed + !stale)
- [ ] line drift — covered by D.7 tests, not re-tested in D.9
- [ ] ambiguous — covered by D.7 tests

### Security
- [x] tenant A → project B (404)
- [x] missing auth (401)
- [ ] invalid/expired MCP token — NOT VERIFIED live (code path via `resolveMcpAuth`)

---

## Staging E2E blockers

The following are **required** but **not available** in the local development environment:

1. `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_SLUG`
2. Staging deployment with public webhook URL
3. Migrations 050 + 051 applied on staging Supabase
4. Registered staging GitHub App installed on a test repository
5. `SEQURAI_API_KEY` + connected project for Actions workflow test

See `docs/GITHUB_APP_STAGING_RUNBOOK.md` for execution steps.

---

## Gate summary

| Gate | Verdict |
|------|---------|
| **CODE GO** | **GO** |
| **STAGING GO** | **NO-GO** — no live E2E evidence |
| **PRODUCTION GO** | **NO-GO** — staging not validated |

---

## Exact next step

1. Register staging GitHub App per runbook
2. Apply migrations 050/051 on staging Supabase
3. Deploy staging with `GITHUB_APP_*` env vars
4. Connect test repo → push commit → verify webhook scan → Check Run
5. Copy `examples/github-actions/sequrai-production-verdict.yml` → run with secrets
6. Push second commit on PR → confirm stale/old SHA not success
7. Execute oauth_legacy rollback test (runbook §9)
8. Update this document with PASS from real evidence
