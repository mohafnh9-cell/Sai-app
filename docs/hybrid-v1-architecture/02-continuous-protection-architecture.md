# Continuous Protection Architecture (Hybrid V1)

**Product spec:** [../continuous-protection/README.md](../continuous-protection/README.md)

---

## Control flow

```
Triggers:
  • Inngest cron (daily / weekly / monthly)
  • MCP review_now / web
  • GitHub push webhook (optional per project)

        ▼
scan_jobs (same pipeline as Layer 1)
        ▼
Inngest scan-run + workers
        ▼
Verdict + findings diff vs Memory
        ▼
Side effects:
  • protection_events / snapshots
  • alert evaluator (user)
  • status machine
```

**One pipeline** — CP does not fork a second scan engine.

---

## Inngest functions (logical)

| Function | Role |
|----------|------|
| `cp-daily-batch` | Fan-out daily checks (batched) |
| `cp-daily-project` | Single project daily path |
| `cp-weekly-batch` | Weekly aggregation |
| `cp-monthly-batch` | Monthly report generation |
| `scan-run` | Existing review runner |
| `scan-job-recovery` | Existing 5m cron |

---

## Scheduling strategy

| Scale | Pattern |
|-------|---------|
| 1k projects | One daily cron → loop enqueue per project (acceptable) |
| 10k | **Batch step:** cron enqueues pages of 100 project ids; each step spawns `cp-daily-project` events |
| 50k | Same batch size; stagger hours by `hash(projectId) % 24` to flatten load |

**Not:** 50k separate Inngest crons.

---

## Incremental vs full review

Daily job decision tree (worker):

1. Fetch default branch SHA + lockfile hash.  
2. Compare to last snapshot.  
3. Unchanged → write `continuous_check_completed` only (~cheap).  
4. Changed → enqueue `scan-run` with priority `continuous_protection`.

Org concurrency cap: **3** parallel scan jobs (existing).

---

## Scheduler config

- `SCAN_SCHEDULER=inngest` production default.  
- `inline` + org allowlist for rollback (existing Phase 1.6).  
- CP OFF projects skipped at enqueue.

---

## Dependencies

| Service | Use |
|---------|-----|
| GitHub API | SHA, lockfile, optional push |
| Postgres | Jobs, memory, verdicts |
| Inngest | Orchestration only |

No Redis for CP V1.

---

## Observability

- Job metrics in `scan_job_events`.  
- Ops alerts: stuck jobs, failure rate (not founder alerts).  
- CP success: % daily checks completed / 24h window.

---

## Scale limits (order of magnitude)

| Projects | Daily check writes | Mitigation |
|----------|-------------------|------------|
| 1.5k | ~1.5k jobs/day | Default |
| 15k | ~15k jobs/day | Batching + incremental SHA skip |
| 75k | ~75k jobs/day | Stagger + incremental; consider scan worker split at 50k (future) |

---

## Related

- [02-continuous-protection-architecture.md](./02-continuous-protection-architecture.md) — this doc  
- [03-memory-architecture.md](./03-memory-architecture.md)  
- [05-alerts-architecture.md](./05-alerts-architecture.md)
