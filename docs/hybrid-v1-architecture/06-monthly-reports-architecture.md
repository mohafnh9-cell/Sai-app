# Monthly Reports Architecture (Hybrid V1)

**Product spec:** [../protection-reports/README.md](../protection-reports/README.md)

Includes **weekly** aggregation jobs — same narrative builder, shorter window.

---

## Pipeline

```
Inngest cp-monthly-batch (day 1)
        ▼
For each project (batched steps):
        ▼
Report aggregator SQL → Memory snapshots + event counts
        ▼
Narrative builder (shared with MCP production_history)
        ▼
Persist: monthly_report record (html, metrics json, snapshot_ids)
        ▼
Memory: monthly_report_generated
        ▼
Email sender (if enabled) + archive URL
```

Weekly: `cp-weekly-batch` — same builder, `rangeDays=7`, no PDF.

---

## Storage

| Artifact | Location |
|----------|----------|
| Report HTML | Postgres `protection_reports` table **or** blob + pointer (50k) |
| PDF | Vercel Blob / R2 — **optional V1**; generate async Inngest step |
| Metrics JSON | Postgres for idempotent regenerate |

**V1 default:** HTML in Postgres for &lt;10k reports/month; move blob at 50k.

---

## Idempotency

`UNIQUE(project_id, period_yyyy_mm)` — regenerate overwrites same row, new Memory event only if content hash changed.

---

## Compute

- **No scan** in report job — read-only aggregation.  
- CPU: narrative formatting on Vercel/Inngest — bound templates, no LLM required for V1 ship.  
- Optional LLM polish — **backlog** (trust + cost).

---

## Email

- Template render server-side.  
- Provider: existing transactional email.  
- Unsubscribe flag on user/org settings.

---

## MCP parity

`production_history` with `rangeDays=30` calls **same aggregator functions** as monthly job — single source of truth.

---

## Scale

| Reports/month | Strategy |
|---------------|----------|
| 1.5k | Single monthly function loop |
| 15k | Batch 100 projects per Inngest step |
| 75k | Batch + off-peak schedule; blob storage for HTML |

---

## Related

- [03-memory-architecture.md](./03-memory-architecture.md)  
- [10-scaling-strategy.md](./10-scaling-strategy.md)
