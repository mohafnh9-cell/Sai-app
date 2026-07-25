# Operational Observability

## Event model

All async pipeline events flow through `server/observability/operational-events.ts`.

Supported events:

- `job_created`, `job_queued`, `job_started`, `job_completed`, `job_failed`, `job_retried`, `job_cancelled`, `job_timed_out`, `job_recovered`
- `duplicate_webhook_detected`, `duplicate_scan_prevented`
- `verdict_created`, `verdict_failed`
- `notification_sent`, `notification_failed`

Each event includes safe fields only: IDs, durations, attempt counts, failure codes, timestamps. Forbidden keys are stripped before logging or persistence.

## Storage

- **Structured logs:** JSON to stdout (Vercel log drain compatible)
- **Durable events:** `scan_job_events` table (migration `021`)
- **In-process counters:** `server/observability/metrics.ts` (supplements DB aggregation)

## Metrics

| Metric | Source |
|---|---|
| `jobs_*_total` | Event → counter mapping |
| `active_jobs` | Health endpoint query |
| `queue_wait_time` / `job_duration` | `scan_job_events` percentiles |
| `stuck_jobs_total` | Recovery scan |

## Health endpoint

`GET /api/internal/jobs/health` with header `x-sequrai-ops-token: $INTERNAL_OPS_TOKEN`

Returns queue/running/failed counts, stuck jobs, p95 durations, scheduler mode. No tenant secrets or payloads.

## Alert configuration

| Alert | Signal | Where to configure |
|---|---|---|
| Stuck job | `stuckJobs > 0` | Vercel log drain + Supabase scheduled query |
| Queue wait p95 > 2m | health endpoint `queueWaitMs.p95` | Inngest + ops cron |
| Failure rate > 1% | `failedJobsLast24h / jobs_created_total` | Supabase SQL + PagerDuty |
| Timeout rate > 1% | `job_timed_out` events | Vercel logs |
| 10+ failures / 15m | `scan_job_events` count | Supabase webhook |
| Recovery exhausted | `recovery_exhausted` events | Inngest dashboard |
| Job near timeout | `execution_deadline_at - now() < 2m` | Recovery cron |

Sentry is documented as the recommended error sink but not yet wired in code.
