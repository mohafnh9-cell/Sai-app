# Phase 1.6 — Progressive Production Cutover

## Step 1: Apply migrations

**Staging:**

```bash
npm run db:apply-migrations
# or manually in Supabase SQL editor:
#   database/migrations/020_scan_jobs.sql
#   database/migrations/021_scan_job_observability.sql
npm run validate:migrations
# fallback: run scripts/migration-preflight.sql in SQL editor
```

**Production:** apply same migrations during maintenance window. Do not auto-apply.

## Step 2: Deploy with inline scheduler

```
SCAN_SCHEDULER=inline
INTERNAL_OPS_TOKEN=<generated>
SCAN_JOB_QUEUE_STALE_MINUTES=10
SCAN_JOB_RECOVERY_MAX_ATTEMPTS=3
```

Deploy code. Verify health endpoint returns `schedulerMode: "inline"`.

## Step 3: Verify health and schema

```bash
curl -H "x-sequrai-ops-token: $INTERNAL_OPS_TOKEN" https://app.example.com/api/internal/jobs/health
npm run validate:migrations
```

## Step 4: Enable Inngest (limited rollout)

Use organization allowlist for progressive cutover:

```
SCAN_SCHEDULER=inngest
INNGEST_ASYNC_ORG_ALLOWLIST=<org-uuid-1>,<org-uuid-2>
```

Only allowlisted organizations use Inngest. All others remain on inline `after()` scheduling.

Verify:

```bash
# Org in allowlist → scan_enqueued_inngest in logs
# Org not in allowlist → scan_enqueued_inline in logs
```

## Step 5: Beta organizations (10%)

- Select 2–3 beta orgs
- Monitor 24 hours: failure rate, queue wait, stuck jobs, alerts
- Run health poll every 5 minutes

## Step 6: Expand to 50%

- Add orgs incrementally
- Monitor 24 hours with same thresholds

## Step 7: Global enable

```
SCAN_SCHEDULER=inngest
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...
```

Remove allowlist if used. Monitor 48 hours.

## Automatic rollback conditions

Rollback immediately if any of:

| Condition | Action |
|---|---|
| Stuck jobs > 0 for > 15 min | Set `SCAN_SCHEDULER=inline`, redeploy |
| Permanent failure rate > 5% for 1 hour | Rollback + incident review |
| Duplicate side effects > 0 | Rollback + disable recovery cron |
| Health endpoint unavailable > 5 min | Rollback if scans failing |
| Queue wait p95 > 5 min sustained | Rollback or reduce traffic |
| Inngest vendor outage | Rollback to inline |

Rollback procedure:

1. `SCAN_SCHEDULER=inline` in Vercel production
2. Redeploy
3. Pause Inngest functions
4. Run `npm run validate:phase1-staging -- --repair-stuck`
5. Post-incident review before re-enabling

## Post-cutover

- Keep recovery cron enabled
- Keep health polling active
- Configure `OPS_ALERT_WEBHOOK_URL` for on-call routing
