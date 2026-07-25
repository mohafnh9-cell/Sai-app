# Phase 1.6 — Inngest Staging Activation Checklist

## Prerequisites

- [ ] Migrations 020 + 021 applied on staging database
- [ ] `SCAN_SCHEDULER=inngest` on staging Vercel project
- [ ] `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` set
- [ ] Staging app deployed with `/api/inngest` route

## Inngest Dashboard Steps

1. **Create or link app**
   - App URL: `https://<staging-host>/api/inngest`
   - Environment: staging

2. **Sync functions** (Deploy → Sync)
   - Confirm these functions appear:
     - `github-webhook-process` — webhook processing
     - `scan-run` — scan execution (concurrency key: `organizationId`, limit 3)
     - `scan-job-recovery` — cron `*/5 * * * *`

3. **Verify signing**
   - Copy signing key into Vercel `INNGEST_SIGNING_KEY`
   - Send test event from dashboard → expect 200 from serve endpoint
   - Invalid signature → expect 401 (logged as signing failure)

4. **Verify retries**
   - `scan-run`: retries = 3, finish timeout = 15m
   - `github-webhook-process`: retries = 3
   - Failed runs visible in Runs tab with `failure_code` in job row

5. **Verify recovery cron**
   - Functions → `scan-job-recovery` → confirm cron schedule
   - Trigger manual run → check return payload `{ scanned, recovered, finalized, failed }`

6. **Payload safety**
   - Inspect a `scan/run` event in dashboard
   - Confirm payload contains only `{ scanJobId, scanId, organizationId, ... }` — no tokens, source code, or raw webhook bodies

## Post-activation smoke

```bash
npm run validate:phase1-6 -- --env --health
curl -s -o /dev/null -w "%{http_code}" https://<staging>/api/internal/jobs/health
# expect 401

curl -s -H "x-sequrai-ops-token: $INTERNAL_OPS_TOKEN" https://<staging>/api/internal/jobs/health | jq '.schedulerMode,.stuckJobs,.alerts.healthy'
# expect inngest, 0, true
```

## Rollback

Set `SCAN_SCHEDULER=inline` in Vercel → redeploy → pause functions in Inngest dashboard.
