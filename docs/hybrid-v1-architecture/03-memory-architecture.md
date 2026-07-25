# Memory Architecture (Hybrid V1)

**Product spec:** [../production-memory/README.md](../production-memory/README.md)

---

## Write path

```
scan-run complete / can_i_deploy / safe_fix / CP cron / alert service
        │
        ▼
appendProtectionEvent()  →  protection_events (append-only)
        │
        ├── rollup job → protection_snapshots (1 row / project / day)
        ├── upsert     → protection_recommendations
        └── insert     → protection_deployments
```

**Transactional boundary:** event + snapshot update in **one DB transaction** per completion where possible.

---

## Read path

| Consumer | Query pattern |
|----------|---------------|
| `what_changed` | `snapshots` ORDER BY date DESC LIMIT 2 — app-layer diff |
| `production_history` | Snapshots 30d + selective events (fixes, material) |
| Protection Center | Latest snapshot + timeline merger (10 episodes) |
| Weekly/monthly jobs | Aggregate SQL on snapshots + event counts |
| Reports | Same aggregators — single narrative builder |

**V1 rule:** Do not scan full `protection_events` for charts at 10k+ — **snapshots required**.

---

## Diff engine

- Input: snapshot A, snapshot B (JSON columns: confidence, status, worries hash, finding counts, dep hash, attack surface level).  
- Output: structured delta → formatter (MCP + alerts + reports).  
- Optional: `contentHash` per snapshot to skip no-op writes.

---

## Retention

| Data | Retention |
|------|-----------|
| protection_events | 12 months hot in Postgres |
| protection_snapshots | 12 months minimum |
| Cold archive | Object storage — **architecture only** at 50k |

---

## Indexing (required for ship)

```text
protection_events (project_id, occurred_at DESC)
protection_events (project_id, type, occurred_at DESC)
protection_snapshots (project_id, snapshot_date DESC) UNIQUE
protection_recommendations (project_id, status)
protection_deployments (project_id, occurred_at DESC)
```

---

## RLS

- User reads: org member + project access.  
- Writes: service role from Inngest/web workers only.

---

## Scale

| Tier | Memory architecture change |
|------|----------------------------|
| 1k | Single table events OK |
| 10k | Monthly partition `protection_events` **optional**; snapshots mandatory |
| 50k | Read replica for MCP history; partition or archive events &gt;12mo |

**No second database** in Hybrid V1.

---

## Idempotency

- `operation_idempotency` or event `idempotencyKey` unique index.  
- Daily snapshot upsert on `(project_id, snapshot_date)`.

---

## Related

- [04-event-architecture.md](./04-event-architecture.md)  
- [08-database-architecture.md](./08-database-architecture.md)
