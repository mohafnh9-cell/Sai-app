# Incident Response — Async Scan Pipeline

## Jobs stuck in queued/running

1. Check health: `GET /api/internal/jobs/health` with ops token
2. Inspect Inngest dashboard for failed functions
3. Run `npm run validate:phase1-staging -- --repair-stuck`
4. Verify recovery cron `scan-job-recovery` is registered
5. If scans completed but jobs stuck, wait for recovery finalize or manually mark failed

## Inngest unavailable

1. Set `SCAN_SCHEDULER=inline` in Vercel
2. Redeploy — webhooks and scans use `after()` path
3. Monitor Vercel function duration limits
4. Re-enable Inngest when vendor restored

## Duplicate GitHub events

Expected behavior: HTTP 202 with `duplicate: true`. No second scan. Check `scan_job_events` for `duplicate_webhook_detected`.

## AI provider failure

Scans may complete with deterministic findings; AI summaries degrade. Verdict engine still runs. Check `verdict_failed` events.

## Database latency

1. Check Supabase dashboard
2. Reduce concurrent scans if needed
3. Pause load tests
4. Scale Supabase compute if sustained

## Notification delivery failure

Check `notification_failed` events. In-app notifications use idempotency keys — safe to retry finalize via recovery.

## Rollback to inline scheduler

```bash
SCAN_SCHEDULER=inline
```

Remove or leave Inngest keys unset. Redeploy. Confirm manual scan + webhook still return 202.

## Escalation

- P1: stuck jobs > 15 min affecting paying customers
- P2: failure rate > 5% for 1 hour
- P3: elevated queue wait p95
