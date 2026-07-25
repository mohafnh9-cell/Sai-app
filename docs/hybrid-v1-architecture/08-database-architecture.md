# Database Architecture (Hybrid V1)

**Primary:** PostgreSQL on **Supabase** — single OLTP store for Hybrid V1.

---

## Schema domains

| Domain | Tables (logical) |
|--------|------------------|
| **Tenancy** | organizations, members, projects |
| **Reviews** | scans, findings, verdicts |
| **Jobs** | scan_jobs, scan_job_events, operation_idempotency |
| **Memory** | protection_events, protection_snapshots, protection_recommendations, protection_deployments |
| **Reports** | protection_weekly_summaries, protection_monthly_reports (or unified `protection_reports`) |
| **Alerts** | security_notifications, alert_dedupe_keys (optional) |
| **Remediation** | fix_approval_audit (or columns on recommendations) |
| **Billing** | subscription fields / Stripe ids |
| **Auth** | Supabase auth.users + app membership |

No ClickHouse, no Redis **required** for ship.

---

## Migrations

- Forward-only SQL in repo (`migrations/`).  
- Preflight scripts for staging/prod ([../operations/migration-preflight-report.md](../operations/migration-preflight-report.md)).  
- Zero-downtime: additive columns → backfill → switch reads → drop old (when needed).

---

## RLS policy pattern

```text
organizations  → member can read org
projects       → member can read if org_id match
protection_*   → same via project join
service_role   → bypass for workers (Inngest)
```

MCP uses user JWT → Supabase client with RLS **or** server-side check then service read — **one pattern** per codebase convention.

---

## Connection management

| Tier | Approach |
|------|----------|
| 1k | Supabase pooler session mode |
| 10k | **Transaction mode** pooler; limit Vercel concurrent connections |
| 50k | Read replica DSN for MCP read tools; writer single primary |

---

## Partitioning (10k+ optional)

`protection_events` PARTITION BY RANGE (occurred_at) monthly — attach/detach for archive.

Snapshots table stays non-partitioned (one row/day/project).

---

## Backup & DR

- Supabase PITR (Pro).  
- No custom DR multi-region in V1 — single region acceptable for founder product.

---

## Estimated write volume

| Scale | protection_events/day | Mitigation |
|-------|----------------------|------------|
| 1k users | ~50k | Indexes |
| 10k users | ~500k | Snapshots + partition consider |
| 50k users | ~2.5M | Partition + archive + replica reads |

---

## What we do not add for V1

- Read models in Redis  
- Dual-write to analytics DB  
- Per-tenant databases  

---

## Related

- [03-memory-architecture.md](./03-memory-architecture.md)  
- [10-scaling-strategy.md](./10-scaling-strategy.md)
