# Future Architecture Specification

**Purpose:** Document **interfaces** for scale beyond 50k and Year 2 features — **without** implementing them in Hybrid V1.

**Anti-pattern:** Building target-architecture ([../architecture/target-architecture.md](../architecture/target-architecture.md)) Redis/ClickHouse/Fly **before** snapshot batching and indexes are done.

---

## Deferred components

| Component | Trigger | Interface preserved |
|-----------|---------|-------------------|
| **Redis / Upstash** | Job lock contention; MCP rate limit hot spots | Same `scan_job` enqueue API |
| **ClickHouse** | Analytics on &gt;50M events/month | Export `protection_events` batch ETL |
| **Fly / dedicated workers** | Scans &gt;15m Vercel limit | Same Inngest event payload `scan-run` |
| **Kafka/NATS** | Outbox backlog &gt;1M/day | Outbox row schema |
| **Read replica** | MCP p95 &gt;2s on history | Connection string env split |
| **Blob store for reports** | Postgres row size / count | `report_url` column |
| **Runtime signal API** | Continuous prod behaviour | `runtime_signals` table stub |
| **Slack alerts** | User channel choice | Notification adapter interface |

---

## What Hybrid V1 must not fork

| Must stay stable | Reason |
|------------------|--------|
| Five MCP tools | Client ecosystem |
| `protection_events` event types | Memory moat |
| `scan_jobs` lifecycle | Ops runbooks |
| Idempotency key shapes | Data integrity |
| Org-scoped tenancy | Security |

---

## Multi-region (backlog)

V1: **single region** (Vercel + Supabase aligned).  
Future: read-only replica in second region for MCP; writer stays primary — no CRDT rewrite.

---

## Enterprise (backlog)

SSO, SCIM, audit export, custom retention — **not** Hybrid V1.  
Schema: leave `organizations.settings` JSON for flags.

---

## ML behaviour (backlog)

Replace rule evaluator with model — **same** alertKind inputs/outputs.

---

## Relation to infra phases

| Phase | Status | Hybrid V1 uses |
|-------|--------|----------------|
| 1–1.6 | Jobs, health, recovery | Yes |
| 2 (Redis, Fly, Kafka) | Architecture only | No ship requirement |

---

## Promotion rule

New infra requires:

1. Bible doc 03 amendment  
2. Load test evidence at prior tier ceiling  
3. Rollback plan (allowlist, env flag)

---

## Related

- [10-scaling-strategy.md](./10-scaling-strategy.md)  
- Product backlog packs (continuous-protection, security-alerts, etc.)
