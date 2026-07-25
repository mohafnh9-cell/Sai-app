# MCP Architecture (Hybrid V1)

**Constraint:** Five tools frozen — protocol and routing unchanged at scale.

---

## Topology

```
MCP clients (Cursor, Claude Code, …)
        │  HTTPS (SSE / streamable HTTP)
        ▼
Vercel — Next.js MCP route(s)
        │
        ├── Auth middleware (user/org token, project scope)
        ├── Intent router (phrase → tool — intent-model.ts)
        ├── execute-tool (thin orchestration)
        │     ├── review_now      → enqueue scan_job
        │     ├── can_i_deploy    → verdict read (+ optional cache)
        │     ├── safe_fix        → fix engine (sync, bounded)
        │     ├── what_changed    → memory diff service (read)
        │     └── production_history → memory narrative (read)
        └── Response formatter (founder language, i18n)
        │
        ▼
Postgres (verdicts, memory snapshots, jobs)
        ▲
Inngest (async review completion — not blocking MCP)
```

**Rule:** MCP never runs full repo scan inline beyond **ack + job id** for `review_now`.

---

## Runtime (Vercel)

| Concern | V1 choice |
|---------|-----------|
| MCP route runtime | Node.js (not Edge) — GitHub + long-ish formatters |
| Time limit | Return fast; poll job status via web or second MCP call pattern |
| Region | Primary region; sticky optional at 10k |

---

## Read vs write paths

| Tool | DB pattern | Cache |
|------|------------|-------|
| `can_i_deploy` | Latest verdict + snapshot | Org-scoped 60–120s cache at 10k |
| `what_changed` | 2 snapshots or 2 verdicts | Snapshot ids in cache key |
| `production_history` | Snapshots + aggregated events | Prebuilt weekly/monthly narrative rows optional |
| `safe_fix` | Write recommendation + read finding | Idempotency key |
| `review_now` | Insert scan_job | Idempotency per org:project:reason |

---

## Scale tiers

| Users | MCP changes |
|-------|-------------|
| **1k** | Single Vercel project; no read replica |
| **10k** | Per-org rate limit (middleware); verdict summary cache; connection pooler |
| **50k** | Optional **second Vercel deployment** same repo — MCP-only routes; Postgres read replica for history/diff only |

**No rewrite:** same `execute-tool` module; deploy split is routing only.

---

## Rate limiting

| Limit | Value (starting) |
|-------|------------------|
| MCP requests / org / minute | 60 |
| `review_now` / org / hour | 20 |
| Burst | Token bucket in Postgres or Vercel KV **only if needed at 10k** — prefer Postgres counter table first |

---

## Security

- Project access enforced before any tool runs.  
- No secrets in responses; sanitize fix prompts.  
- Audit log: tool name + projectId + userId (analytics table — not Memory).

---

## Failure modes

| Failure | MCP behavior |
|---------|--------------|
| Stale verdict | `can_i_deploy` says stale; suggest `review_now` |
| Job queue saturated | 429 with retry-after; honest message |
| DB timeout on history | Shorter range default; degrade to snapshot-only |

---

## Related

- [../mcp-product/01-mcp-product-specification.md](../mcp-product/01-mcp-product-specification.md)  
- [10-scaling-strategy.md](./10-scaling-strategy.md)
