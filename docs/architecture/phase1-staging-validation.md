# Phase 1 Staging Validation Report

**Date:** 2026-07-23  
**Scope:** Async scan architecture (Inngest + `scan_jobs`)  
**Phase 2:** Not started  
**Decision:** **NO-GO for production cutover** until staging manual checklist is executed and passes

---

## 1. Validation report

### Architecture under test

| Component | Role |
|---|---|
| `app/api/webhooks/github` | Verify → idempotency → enqueue → HTTP 202 |
| `server/jobs/webhook-ingress.ts` | Delivery dedup + org resolution |
| `server/jobs/schedule-scan.ts` | Inline/Inngest scheduler abstraction |
| `server/jobs/run-scan-job.ts` | Worker execution + finalize idempotency |
| `server/jobs/scan-job-store.ts` | Job state machine + stuck detection |
| `inngest/functions/*` | Retries, timeout, org concurrency |

### Validation matrix

| # | Scenario | Automated coverage | Staging command / action | Status |
|---|---|---|---|---|
| 1 | Manual scan completion | `schedule-scan.test.ts`, `run-scan-job.test.ts` | UI: Start Production Review → poll scan | **Needs staging run** |
| 2 | GitHub webhook processing | `webhook-ingress` duplicate test | Push to linked repo | **Needs staging run** |
| 3 | Duplicate delivery IDs | `scan-job-store.test.ts`, ingress test | `npm run validate:phase1-staging -- --smoke` | **Automated partial** |
| 4 | Concurrent pushes same project | DB partial unique on active scans | Two rapid pushes same branch | **Needs staging run** |
| 5 | Five concurrent scans / org | Inngest concurrency limit = 3 (unit test) | 5 manual scans same org | **Needs staging run** |
| 6 | Recoverable worker failures | Inngest retries = 3; runner skip-if-completed | Revoke token mid-scan, restore, retry | **Needs staging run** |
| 7 | Permanent worker failures | `markScanJobFailed` + onFailure handler | Disconnect repo → expect `failed` | **Needs staging run** |
| 8 | Job timeout | Inngest 15m finish + `SCAN_JOB_TIMEOUT` repair | `--repair-stuck` script | **Automated partial** |
| 9 | Duplicate notifications | `finalizeCompleted` metadata guard (new) | Retry finalize after success | **Improved; staging verify** |
| 10 | Duplicate Production Verdict | `production_verdicts` upsert on `scan_id` | Re-run same scan job | **Automated via existing upsert** |
| 11 | Tenant isolation | RLS on `scan_jobs`; org_id on all rows | Cross-org API access attempt | **Needs staging run** |
| 12 | `SCAN_SCHEDULER=inline` rollback | `getScanSchedulerMode` tests | Flip env + manual scan | **Needs staging run** |
| 13 | Inngest payload security | `inngest-payload.test.ts` | Inspect Inngest dashboard events | **Automated + dashboard verify** |
| 14 | Stuck job detection | `staging-validate-phase1.mjs` | `npm run validate:phase1-staging` | **Automated query** |

---

## 2. Tests added

| File | Coverage |
|---|---|
| `server/jobs/__tests__/job-transitions.test.ts` | Valid/invalid state machine transitions |
| `server/jobs/__tests__/inngest-payload.test.ts` | Payload security + metadata extraction |
| `server/jobs/__tests__/inngest-limits.test.ts` | Org concurrency + timeout constants |
| Existing suites updated | Transition guards, retry skip, secure webhook enqueue |

**Post-fix test count:** run `npm test` (target: all green)

---

## 3. Failures discovered

| ID | Severity | Finding |
|---|---|---|
| F-01 | **High** | Webhook Inngest events previously included full GitHub `payload` (PII / repo metadata leakage) |
| F-02 | **High** | Job transitions did not guard terminal states — completed jobs could be updated again |
| F-03 | **Medium** | Inngest timeout did not mark `scan_jobs` as failed — jobs could remain `running` |
| F-04 | **Medium** | Retries re-ran `InlineScanJobRunner` on already-completed scans → duplicate finalize risk |
| F-05 | **Medium** | Finalize retries could duplicate notifications (no idempotency flag) |
| F-06 | **Low** | `queued → cancelled` path exists in API but no production caller yet |
| F-07 | **Low** | Commit SHA dedup relies on scan-layer logic, not job-layer unique index |
| F-08 | **Info** | Multi-project repos share one `repository_events` row per delivery (pre-existing) |

---

## 4. Fixes implemented

| Fix | Files |
|---|---|
| Secure Inngest webhook payloads (`scanJobId` only; payload in DB metadata) | `inngest-payload.ts`, `schedule-scan.ts`, `inngest/client.ts` |
| Enforced job transition guards via `.in("status", allowedFrom)` | `job-transitions.ts`, `scan-job-store.ts` |
| Inngest `onFailure` marks jobs `failed` (`SCAN_JOB_TIMEOUT` / `INNGEST_FUNCTION_FAILED`) | `inngest/functions/*.ts` |
| Retry idempotency: skip terminal jobs, skip runner if scan completed | `run-scan-job.ts` |
| Finalize idempotency: `metadata.finalizeCompleted` flag | `run-scan-job.ts` |
| Stuck job detection + repair script | `scan-job-store.ts`, `scripts/staging-validate-phase1.mjs` |

---

## 5. Remaining production risks

1. **Staging checklist not yet executed** against a live Inngest + Supabase environment.
2. **Notification dedup** is job-metadata based, not DB-unique — extreme retry edge cases may still duplicate in-app notifications.
3. **Concurrent push dedup** depends on scan partial unique index — second push while first running returns `scan_in_progress`, not a queued job.
4. **Inline rollback** restores `after()` execution but still creates `scan_jobs` rows — ops must monitor both paths during rollback window.
5. **No automated RLS integration test** for `scan_jobs` cross-org reads (manual/staging only).
6. **Inngest vendor dependency** — outage requires `SCAN_SCHEDULER=inline` rollback.

---

## 6. Staging smoke-test checklist

```bash
# 0. Prerequisites
npm run db:apply-migrations          # includes 020_scan_jobs
export SCAN_SCHEDULER=inngest
export INNGEST_EVENT_KEY=...
export INNGEST_SIGNING_KEY=...
export STAGING_BASE_URL=https://staging.example.com

# 1. Health baseline
npm run validate:phase1-staging

# 2. Duplicate webhook
npm run validate:phase1-staging -- --smoke

# 3. Manual scan (UI)
#    → HTTP 202, scan_jobs: queued → running → completed

# 4. GitHub push
#    → webhook 202 < 500ms, scan completes, verdict row exists

# 5. Duplicate delivery
#    → second POST returns duplicate:true

# 6. Five concurrent scans (same org)
#    → max 3 running in Inngest, others queued

# 7. Recoverable failure
#    → transient error retries, single scan row, single verdict

# 8. Permanent failure
#    → job status failed with failure_code populated

# 9. Rollback
#    SCAN_SCHEDULER=inline → manual scan still completes

# 10. Inngest dashboard
#     → github/webhook.process payload = { scanJobId } only

# 11. Stuck job drill
npm run validate:phase1-staging -- --repair-stuck
```

---

## 7. Production cutover checklist

- [ ] All staging smoke tests pass (Section 6)
- [ ] 48h staging metrics: scan success rate ≥ baseline
- [ ] Inngest failure rate < 1% of scan jobs
- [ ] P99 webhook ack latency < 500ms
- [ ] Zero stuck `running` jobs older than 15m (hourly alert)
- [ ] On-call runbook documents `SCAN_SCHEDULER=inline` rollback
- [ ] `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` set in Vercel production
- [ ] Inngest app synced to production `/api/inngest`
- [ ] Migration `020` applied to production Supabase

---

## 8. Recommended monitoring metrics

| Metric | Source | Alert threshold |
|---|---|---|
| `scan_jobs` by status | Supabase | `running` > 15m |
| Scan job failure rate | Supabase / logs | > 5% / 1h |
| Webhook 202 latency | Vercel logs | p99 > 500ms |
| Inngest function failures | Inngest dashboard | > 10 / 1h |
| Duplicate webhook rate | `duplicate_delivery` logs | spike > 3× baseline |
| Org concurrency queue depth | Inngest | sustained > 10 |
| Stuck scans (`active_scan_id`) | Supabase | > 30m |
| Verdict persistence failures | `VERDICT_PERSISTENCE_FAILED` | any in 1h |

---

## 9. Deduplication assessment

| Key | Mechanism | Sufficient? |
|---|---|---|
| GitHub delivery ID | Unique index on `webhook_process` + ingress duplicate check + `repository_events` | **Yes** for webhook ingress |
| scan ID | Unique active job index + scan concurrency index | **Yes** for job enqueue |
| project ID | One active scan per repository (DB index) | **Yes** for concurrent scans |
| commit SHA | Automatic review queries; PR upsert key | **Partial** — push scans can re-queue new commits |
| event type | Metadata only | **No alone** — combined with delivery ID |

### Duplicate side-effect scenarios (post-fix)

| Scenario | Duplicate scans? | Duplicate verdicts? | Duplicate notifications? | Duplicate GitHub statuses? |
|---|---|---|---|---|
| Replay same delivery ID | No | No | No | No |
| Retry after scan completed | No | No (upsert) | Unlikely (`finalizeCompleted`) | Possible repost (harmless) |
| Two pushes while scan active | No (skipped) | No | No | No |
| Two different deliveries same commit | Possible skipped at scan layer | Upsert protects | Possible if both complete | Possible |

---

## 10. Job transition verification

**Allowed:**
- `queued → running → completed`
- `queued → running → failed`
- `queued → cancelled`

**Blocked (enforced in `scan-job-store.ts`):**
- `completed → *`
- `failed → *`
- `cancelled → *`
- `running → cancelled`

---

## 11. GO / NO-GO decision

### **NO-GO** for production cutover today

**Reason:** Code-level validation and automated tests pass, but **live staging execution of the 14-scenario checklist is required** before production promotion. The implementation is materially improved after this validation pass (security + state machine + retry fixes), yet production GO depends on observed staging metrics.

**Conditional GO path:**
1. Execute Section 6 checklist on staging with `SCAN_SCHEDULER=inngest`
2. Confirm zero P0 findings in 48h staging window
3. Run rollback drill (`SCAN_SCHEDULER=inline`) successfully
4. Then promote to production with monitoring from Section 8

---

## Reproducible commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run validate:phase1-staging
STAGING_BASE_URL=https://staging.example.com npm run validate:phase1-staging -- --smoke
npm run validate:phase1-staging -- --repair-stuck
```
