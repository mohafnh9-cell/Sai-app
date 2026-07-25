# Sprint 8 — Production readiness deliverables

Engineering-only sprint (Sprints 1–7 frozen). No user-facing UX changes.

| Document | Purpose |
|----------|---------|
| [production-readiness-report.md](./production-readiness-report.md) | Executive summary and readiness verdict |
| [performance-benchmarks.md](./performance-benchmarks.md) | P50/P95/P99 instrumentation and targets |
| [database-optimization.md](./database-optimization.md) | Indexes, FKs, query patterns |
| [reliability-checklist.md](./reliability-checklist.md) | Jobs, idempotency, recovery |
| [cost-analysis.md](./cost-analysis.md) | Internal cost model and dashboard |
| [technical-debt-register.md](./technical-debt-register.md) | Known gaps post-Sprint 8 |
| [load-test-scenarios.md](./load-test-scenarios.md) | 100 / 1k org scale expectations |

## Internal ops endpoints

All require header `x-sequrai-ops-token: $INTERNAL_OPS_TOKEN`.

- `GET /api/internal/readiness` — unified production readiness summary
- `GET /api/internal/metrics` — in-process counters + operation timings
- `GET /api/internal/cost?hours=24` — cost dashboard snapshot
- `GET /api/internal/jobs/health` — scan job queue health (existing)

Apply migration **027** before relying on new indexes in production.
