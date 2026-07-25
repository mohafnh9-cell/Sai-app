# Job Recovery

## Scheduled recovery

Inngest function `scan-job-recovery` runs every 5 minutes (`inngest/functions/scan-job-recovery.ts`).

## Detection

| Condition | Threshold |
|---|---|
| Stale queued job | `scheduled_at` older than `SCAN_JOB_QUEUE_STALE_MINUTES` (default 10) |
| Stale running job | `execution_deadline_at` in the past |
| Scan completed, job running | scan `status=completed` and job not finalized |
| Heartbeat stale | `heartbeat_at` not updated during long scans |

## Actions

1. **Re-enqueue recoverable jobs** — increments `recovery_attempts`, emits `job_recovered`
2. **Finalize completed scans** — runs finalize path idempotently
3. **Fail unrecoverable jobs** — `RECOVERY_EXHAUSTED` or `RECOVERY_UNRECOVERABLE`
4. **Mark timeouts** — `SCAN_JOB_TIMEOUT` via `job_timed_out`

## Limits

- `max_recovery_attempts` default 3 (`SCAN_JOB_RECOVERY_MAX_ATTEMPTS`)
- Recovery to `queued` is explicit only — never via normal transitions
- Terminal states (`completed`, `failed`, `cancelled`) cannot transition again

## Manual repair

```bash
npm run validate:phase1-staging -- --repair-stuck
```

Or query:

```sql
select id, status, recovery_attempts, execution_deadline_at
from scan_jobs
where status in ('queued','running')
  and updated_at < now() - interval '15 minutes';
```

## Rollback

Disable recovery by removing `scanJobRecoveryFunction` from `/api/inngest` serve list, or pause the function in Inngest dashboard. Observability tables remain safe to keep.
