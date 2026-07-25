# Future Architecture — Scaling Memory (1k → 50k)

**Constraints:** **Postgres + Inngest + existing stack** only for Hybrid V1 ship. **No rewrite** at tier jumps.

**Technical pack:** [../hybrid-v1-architecture/03-memory-architecture.md](../hybrid-v1-architecture/03-memory-architecture.md)

---

## Scale assumptions

| Tier | Projects | Snapshots/day | Events/day (order) |
|------|----------|---------------|---------------------|
| **1k users** | ~1.5k | ~1.5k | ~50k |
| **10k users** | ~15k | ~15k | ~500k |
| **50k users** | ~75k | ~75k | ~2.5M |

---

## 1,000 users — ship baseline

**Do:**

- All entities in doc 11 on single Supabase Postgres  
- Indexes on `(project_id, occurred_at)`, `(project_id, snapshot_date)`  
- Daily snapshot upsert mandatory  
- MCP reads snapshots for diff/history  
- Profile row for 30-second timeline stats  
- Inngest daily batch (simple fan-out)

**Do not:**

- Read replica, partitions, Redis, second DB

**SLO:** MCP history p95 &lt; 1.5s; snapshot job backlog &lt; 6h

---

## 10,000 users — tighten

**Add:**

| Lever | Effort |
|-------|--------|
| PgBouncer transaction pooling | Config |
| `protection_events` monthly partitions (optional) | Migration |
| Nightly profile counter reconciliation job | Small |
| Weekly/monthly narrative cache tables | Already designed |
| Stagger daily CP by `hash(project_id)` | Inngest |
| Cap MCP `production_history` default range 30d | Product |

**Still one Postgres primary.**

**SLO:** MCP history p95 &lt; 2s; daily snapshot 99% within 24h

---

## 50,000 users — extend (same schema)

**Add:**

| Lever | Effort |
|-------|--------|
| Read replica for MCP `what_changed` + `production_history` | DSN split |
| Archive events &gt;12mo to blob; keep snapshots hot | Job |
| Report HTML in blob; Postgres pointer | Medium |
| Stronger batch sizes (100→200) on aggregators | Config |
| Outbox for alert/report email | Table |

**Still no mandatory ClickHouse/Redis/Kafka for memory reads.**

**SLO:** Diff p95 &lt; 1s from snapshots; monthly batch completes &lt; 6h

---

## What never changes at scale

- Append-only event semantics  
- Five MCP tools  
- No secrets in memory  
- Snapshot as chart/diff source of truth  
- 30-second founder story from **profile + milestones**, not 10k row scan

---

## Failure modes

| Symptom | Fix order |
|---------|-----------|
| Slow history | Replica + snapshot-only reads |
| Write pressure | Partition events; reduce payload size |
| Disk | Archive + retention job |
| Wrong counters | Reconciliation from events |

---

## Inngest fan-out (all tiers)

```
cp-daily-batch (cron)
  → step: load project page N
  → send event cp-daily-project × 100
cp-daily-project
  → update memory per 12-update-strategy
```

Same pattern weekly/monthly.

---

## Acceptance

- Load test: 15k snapshot upserts/day sustained in staging before beta 300.  
- Golden path: 327-day `continuous_protection_days` displays correctly with pause gap.

---

## Related

- [13-ships-now-vs-backlog.md](./13-ships-now-vs-backlog.md)  
- [../roadmap/04-success-metrics.md](../roadmap/04-success-metrics.md)
