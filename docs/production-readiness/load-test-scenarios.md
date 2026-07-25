# Load test preparation

## Scenarios

| Scale | Organizations | Repositories | Reviews (cumulative) | Focus |
|-------|---------------|--------------|----------------------|--------|
| Beta | 100 | 1,000 | 100,000 | End-to-end MCP + scans |
| Growth | 1,000 | 10,000 | 1M | Cron fan-out + DB indexes |
| Stress | 10,000 | 100,000 | 10M | Event retention + pagination |

## Expected bottlenecks

1. **Inngest fan-out** — daily alerts/reports enqueue one event per eligible project (500 cap today). At 10k projects, stagger cron or batch by org shard.
2. **Supabase connection pool** — concurrent scan jobs; prefer queue concurrency limits in Inngest.
3. **scan_job_events write rate** — ~6–10 events per review; plan archival beyond 100k reviews.
4. **Production memory reads** — mitigated by 60s cache; cold cache after deploy spikes latency (P99).
5. **Safe Fix generation** — CPU + LLM bound; limit concurrent generates per org in future flag.

## Pre-load checklist

- [ ] Migration 027 applied
- [ ] `SCAN_SCHEDULER=inngest` for production-like runs
- [ ] `INTERNAL_OPS_TOKEN` + monitoring poll `/api/internal/readiness`
- [ ] Staging script: `node scripts/staging-validate-phase1-6.mjs` (with env)
- [ ] Optional: `scripts/load-test-report.mjs` if present in repo

## Concurrency tests (automated)

Vitest covers:

- Cache coherency under repeated reads
- Metric counter concurrency (single process)
- Operation timing sample caps (2000/op)

Add k6/Artillery in a future sprint for HTTP soak (not required for Sprint 8 deliverables).

## Target reliability

**Critical paths ≥99%** under expected beta load:

- Review queue acceptance
- Scan completion + verdict persistence
- MCP read tools (can_i_deploy, production_history)
- Safe Fix persist + retrieve

Measure via `reviews_completed_total / reviews_started_total` and job_failed rates in metrics export.
