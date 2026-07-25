# Reliability checklist

## Scan jobs (inline + Inngest)

- [x] State machine with terminal guards (`job-transitions`)
- [x] Heartbeats + stuck job detection (`scan-job-store`, recovery function)
- [x] Operational events persisted to `scan_job_events`
- [x] Idempotency keys for verdict operations
- [x] Duplicate webhook / duplicate scan metrics
- [x] Recovery counter + max attempts env

## Inngest functions

| Function | Idempotency | Retry | Notes |
|----------|-------------|-------|-------|
| `scan-run` | Job row status | Inngest default | Completing job is guarded |
| `scan-job-recovery` | Stuck job ids | Safe | Re-queues stale jobs |
| `process-github-webhook` | Delivery dedupe | Safe | Webhook signature required |
| `cp-daily` / `cp-weekly` | CP event keys | Safe | Protection memory writes |
| `alerts-daily` | Alert delivery dedupe | Safe | Material gate reduces noise |
| `reports-protection` | Report period key | Safe | Skip if insufficient data |

## Failure recovery

1. **Worker crash mid-scan** — job remains `running`; recovery marks stale → retry.
2. **Partial finalize** — metadata `finalizeCompleted` flag prevents double finalize.
3. **Inngest retry** — step.run isolates side effects; scan job store prevents double complete.
4. **Dead letter** — failed jobs → `job_failed` event + `platform_failures_total`; ops webhook optional (`OPS_ALERT_WEBHOOK_URL`).

## Duplicate event protection

- GitHub: duplicate webhook metric
- Scans: duplicate scan prevention
- Memory / Safe Fix: idempotency keys on append
- Alerts: candidate fingerprint in lifecycle

## Crash safety checklist

- [x] All job transitions emit operational events
- [x] Metrics increment on retry/failure
- [x] No founder-facing stack traces (`toFounderErrorResponse`)
- [x] Internal routes require ops token

## Manual ops runbook

1. Check `/api/internal/readiness`
2. If `background_workers` degraded → inspect `/api/internal/jobs/health`
3. Trigger `scan-job-recovery` via Inngest dashboard if needed
4. Compare metrics before/after via `/api/internal/metrics`
