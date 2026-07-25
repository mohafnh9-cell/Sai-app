# Database optimization report

## Migration 027 — production readiness indexes

File: `database/migrations/027_production_readiness_indexes.sql`

Adds composite indexes aligned to org/project/time filters used by:

- Continuous protection timelines (`protection_events`)
- Alert inbox and batch evaluation (`security_alerts`)
- Safe Fix history (`safe_fix_records`, verifications via existing FK indexes)
- Report listing (`protection_reports`)
- Job observability (`scan_jobs`, `scan_job_events`)
- Recommendation lookups (`protection_recommendations`)

**Action:** Apply on Supabase before high-volume beta.

## Review summary (existing schema)

| Concern | Finding | Action |
|---------|---------|--------|
| Org isolation | FK `organization_id` → `organizations` ON DELETE CASCADE on Sprint 2–7 tables | No change |
| N+1 on reports | `loadReportSourceData` batches reads | Monitor; cache report summaries at API layer |
| N+1 on alerts | Per-candidate delivery loop | Acceptable at beta scale; index 027 helps filters |
| Duplicate reads | Production memory + protection center | In-memory TTL cache (45–60s) + invalidate on scan complete |
| Missing indexes (hot) | Time-ordered lists per project | Addressed in 027 |
| Scan job recovery | Partial indexes on status + updated_at | Existing 020/021 + 027 event indexes |

## Cascade rules

Sprint tables use **ON DELETE CASCADE** from `organizations` and `projects` — intentional for workspace teardown. Scan job events use **SET NULL** on org for audit retention where defined in 021.

## Query patterns to watch at scale

1. **Eligible project lists** capped at 500 rows (reports/alerts cron) — partition by org or cursor pagination before 10k+ projects.
2. **`scan_job_events` inserts** — one row per operational event; consider retention policy >100k reviews.
3. **Production memory aggregations** — cache + index on `project_memory_events (project_id, created_at desc)`.

## Duplicate write protection

- Safe Fix: `supersedeOpenFixesForRecommendation` + idempotent memory keys
- Reports: persist layer dedupes by period + type
- Alerts: lifecycle dedupe on deliver
- Scans: `duplicate_scans_prevented_total` metric

No behavioural changes in Sprint 8 — indexes and read caching only.
