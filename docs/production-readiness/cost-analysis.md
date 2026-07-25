# Cost analysis (internal)

## Dashboard

`GET /api/internal/cost?hours=24` (ops token required)

Returns counts and **estimated USD** based on env-configurable unit costs:

| Env var | Default | Meaning |
|---------|---------|---------|
| `SEQURAI_COST_REVIEW_USD` | 0.35 | Completed review (LLM + compute) |
| `SEQURAI_COST_SAFE_FIX_USD` | 0.08 | Safe Fix generation |
| `SEQURAI_COST_REPORT_USD` | 0.02 | Weekly/monthly report |

## Data sources

| Metric | Source |
|--------|--------|
| Reviews started | `scan_job_events.event_type = job_started` |
| Reviews completed | `scan_job_events.event_type = job_completed` |
| Safe fixes | `safe_fix_records.created_at` |
| Reports | `protection_reports.generated_at` |
| Alerts | `security_alerts.created_at` |

## Derived averages

- **Avg cost per project** — total estimate / project count
- **Avg cost per organization** — total estimate / org count

## AI tokens

Token-level accounting is **not** persisted in v1. Recommended follow-up:

1. Log `input_tokens` / `output_tokens` in scan finalize metadata (no UX change).
2. Aggregate in warehouse from operational logs.

## Cost controls (existing)

- Alert material gate reduces LLM-adjacent noise
- Report skip when insufficient data
- Duplicate scan prevention

Update `SEQURAI_COST_*` after first month of provider bills.
