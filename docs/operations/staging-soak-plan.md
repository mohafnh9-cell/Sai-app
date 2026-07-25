# Phase 1.6 — 48-Hour Staging Soak Plan

## Duration

48 hours continuous after Inngest activation on staging.

## Metrics to record (every 6 hours)

Run:

```bash
npm run validate:phase1-6 -- --metrics
```

Record:

| Metric | Source |
|---|---|
| Total jobs created | `scan_job_events` job_created |
| Completion rate | completed / created |
| Permanent failure rate | failed / created |
| Retry rate | job_retried / created |
| Recovery count | job_recovered |
| Stuck jobs | health endpoint `stuckJobs` |
| Queue wait p95 | health endpoint `queueWaitMs.p95` |
| Duration p95 | health endpoint `durationMs.p95` |
| Duplicate side effects | operation_idempotency duplicate attempts |
| Webhook ingestion errors | job_failed where job_type=webhook_process |
| Database errors | Supabase dashboard + Vercel function errors |

## Pass criteria

- [ ] Zero lost jobs (created − completed − failed − cancelled = 0 for terminal accounting)
- [ ] Zero duplicate side effects (no duplicate notifications/verdicts/statuses)
- [ ] Zero cross-tenant access incidents
- [ ] Zero unrecovered stuck jobs beyond one recovery cycle (5 min)
- [ ] Permanent failure rate < 1%
- [ ] Queue wait p95 < 2 minutes under expected load
- [ ] Rollback to `SCAN_SCHEDULER=inline` verified (scenario L)
- [ ] Recovery proven via fault injection (scenarios I, J, K)

## Fault injection schedule

| Hour | Action |
|---|---|
| 6 | Scenario I — inject stale queued job |
| 12 | Scenario J — inject expired running job |
| 18 | Scenario G — revoke GitHub token mid-scan |
| 24 | Scenario C — duplicate webhook |
| 30 | Scenario F — 100 webhook burst |
| 36 | Scenario L — rollback to inline for 1 hour, then restore inngest |
| 42 | Scenario K — completed scan + running job |

## Soak log template

Create `docs/operations/phase1-6-staging-results.md` with timestamped entries:

```
## 2026-07-23T12:00:00Z
- jobsCreated: 42
- completionRate: 98.5%
- stuckJobs: 0
- alertsHealthy: true
- notes: ...
```

## GO decision after soak

All pass criteria met for 48 hours → **CONDITIONAL GO** for progressive production cutover (see `production-cutover-phase1-6.md`).

Any P0 incident → **NO-GO**, fix and re-soak.
