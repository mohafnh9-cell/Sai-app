# Performance benchmark report

## Instrumentation

Operation timings are recorded in-process (`recordOperationDuration` / `withOperationTiming`) and exposed at:

`GET /api/internal/metrics` → `operationTimings`

### Tracked operations

| Operation | Where |
|-----------|--------|
| `mcp.tool` | MCP `execute-tool.ts` (meta: `tool`) |
| `api.production_memory` | Production memory API |
| `api.protection_center` | Protection center API |
| `safe_fix.generate` | Safe Fix engine |
| `safe_fix.verify` | Safe Fix verification |
| `report.weekly` / `report.monthly` | Protection reports |
| `alert.evaluate` | Security alerts batch |
| `jobs.scan_run` | (reserved for scan runner wiring) |
| `cp.daily` | (reserved for CP jobs) |

Each summary includes **P50, P95, P99**, sample count, and last duration.

## Scan job metrics (durable)

From `scan_job_events` (staging script `scripts/staging-validate-phase1-6.mjs`):

- Queue wait ms (job_started)
- Job duration ms (job_completed)

## Beta targets (initial)

These are engineering targets for private beta — adjust after first soak.

| Operation | P50 | P95 | P99 |
|-----------|-----|-----|-----|
| MCP tool (read-heavy) | &lt; 800ms | &lt; 2.5s | &lt; 5s |
| MCP review_now (queued) | &lt; 400ms | &lt; 1s | &lt; 2s |
| Production memory API | &lt; 300ms | &lt; 900ms | &lt; 1.5s |
| Protection center API | &lt; 400ms | &lt; 1.2s | &lt; 2s |
| Safe Fix generate | &lt; 2s | &lt; 6s | &lt; 12s |
| Weekly report generate | &lt; 3s | &lt; 10s | &lt; 20s |
| Scan job (full review) | &lt; 90s | &lt; 180s | &lt; 300s |

## How to measure

1. Deploy with `INTERNAL_OPS_TOKEN` set.
2. Run representative MCP + API traffic.
3. Poll `/api/internal/metrics` and export JSON.
4. For DB-backed timings, run staging validate script against production read replica (read-only).

## Regression tests

- `server/observability/__tests__/operation-timing.test.ts` — percentile aggregation
- Existing health summary tests for job event queries
