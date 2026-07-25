# Phase 1.6 — Migration Preflight Report

## Migration order

1. `020_scan_jobs.sql` — creates `scan_jobs` table, partial unique indexes, RLS
2. `021_scan_job_observability.sql` — adds recovery columns, `scan_job_events`, `operation_idempotency`

**Must apply 020 before 021.** Both use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` and are safe to re-run.

## Compatibility

| Check | Status |
|---|---|
| Depends on `organizations`, `projects`, `scans` | Required — must exist |
| Adds columns only (021) | Non-destructive |
| No data migration | Safe |
| RLS member-read policies | Consistent with existing patterns |
| Service role bypasses RLS | Admin client unaffected |

## Index review

| Index | Purpose |
|---|---|
| `idx_scan_jobs_webhook_delivery` | One ingress job per GitHub delivery (partial unique) |
| `idx_scan_jobs_active_scan` | One active job per scan (partial unique) |
| `idx_scan_jobs_stuck_recovery` | Recovery cron queries |
| `idx_scan_job_events_*` | Alert + health percentile queries |
| `idx_operation_idempotency_org_type` | Side-effect audit by org |

## Idempotency

- `operation_idempotency.idempotency_key` — PRIMARY KEY (text)
- Insert conflict `23505` → duplicate side effect prevented
- Re-run of 021 does not duplicate indexes (IF NOT EXISTS)

## RLS policies

| Table | Policy | Access |
|---|---|---|
| `scan_jobs` | Members read scan jobs | SELECT for org members |
| `scan_job_events` | Members read scan job events | SELECT for org members |
| `operation_idempotency` | Members read operation idempotency | SELECT for org members |

Writes use service role (admin client) — no insert policies needed.

## Staging apply commands

```bash
# Option A: migration runner
npm run db:apply-migrations

# Option B: Supabase SQL editor (in order)
# Paste contents of database/migrations/020_scan_jobs.sql
# Paste contents of database/migrations/021_scan_job_observability.sql

# Validate
npm run validate:migrations
# Or run scripts/migration-preflight.sql in SQL editor
```

## Production apply

Apply during maintenance window. **Do not auto-apply.** Run preflight SQL after apply.

## Known gap

`migration-preflight.mjs` requires a Supabase RPC (`exec_sql_check`) that may not exist. Use `scripts/migration-preflight.sql` directly in SQL editor as fallback.
