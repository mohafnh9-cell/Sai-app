# Technical Architecture (Hybrid V1)

**Goal:** Support 1k → 10k → 50k users without a rewrite. Align with existing stack: Next.js (Vercel), PostgreSQL (Supabase), Inngest, MCP, GitHub.

**Complete architecture pack (10 areas + scaling phases):** [../hybrid-v1-architecture/README.md](../hybrid-v1-architecture/README.md).

---

## Architecture principles

1. **MCP edge, Postgres truth** — All protection state durable in Postgres; MCP is stateless RPC.
2. **Jobs for slow work** — Reviews/scans never block HTTP/MCP beyond acknowledgment.
3. **Idempotent side effects** — Verdicts, notifications, PRs, memory writes.
4. **Tenant isolation** — Organization-scoped data + RLS.
5. **Observability without a new platform** — Structured logs, health endpoint, ops alerts (Phase 1.5).
6. **Extension points over premature scale** — Redis/ClickHouse/workers designed, not required for 1k–10k.

---

## MCP architecture

```
Cursor / Claude Code / other MCP client
        │  HTTPS (SSE/stream)
        ▼
Next.js MCP route (/api/mcp or dedicated)
        │
        ├── Auth (org/user token)
        ├── Intent routing (phrase → tool)
        ├── execute-tool.ts
        │     ├── review_now → schedule scan job
        │     ├── can_i_deploy → verdict service (+ cache)
        │     ├── safe_fix → fix engine
        │     ├── what_changed → memory diff service
        │     └── production_history → memory query
        └── Response formatter (founder language)
```

**Scale:**

| Users | Pattern |
|-------|---------|
| 1k | Single Vercel region; MCP on Node runtime; verdict read cached |
| 10k | Edge cache verdict summaries; rate limit per org; MCP read replicas via Postgres read pool |
| 50k | Dedicated MCP worker service (same codebase) if Vercel limits; **no protocol change** |

---

## Protection architecture

```
Triggers: MCP, web, webhooks, cron (Inngest)
        ▼
scan_jobs + Inngest functions
        ▼
Scan/review runners (inline or queued)
        ▼
Verdict engine + domain reviewers
        ▼
Side effects: GitHub status, notifications, memory events, idempotency keys
        ▼
Continuous protection scheduler (daily/weekly/monthly crons)
```

**Org concurrency:** 3 parallel scan jobs per org (existing).  
**Rollback:** `SCAN_SCHEDULER=inline` + org allowlist for progressive cutover.

---

## Database architecture

**Primary:** PostgreSQL (Supabase).

| Domain | Tables (existing + planned logical) |
|--------|-------------------------------------|
| Core product | organizations, projects, scans, findings, verdicts |
| Jobs | scan_jobs, scan_job_events, operation_idempotency |
| Memory (V1 ship) | protection_events, protection_snapshots, protection_recommendations, protection_deployments |
| Billing | Stripe-linked subscription fields |
| Notifications | security_notifications |

**Migrations:** Forward-only; preflight scripts for staging/prod.

**Scale:**

| Users | DB approach |
|-------|-------------|
| 1k | Supabase Pro; indexes on memory timeline |
| 10k | Connection pooling (PgBouncer); partition protection_events by month (optional) |
| 50k | Read replica for MCP history queries; archive cold events to object storage (architecture ready) |

No second database in Hybrid V1.

---

## Event architecture

**Operational events:** `scan_job_events` (job lifecycle).  
**Product events:** `protection_events` (memory).  
**Analytics:** Product analytics pipeline (existing track.ts)—separate from memory.

Event flow:

```
Worker → emitOperationalEvent → stdout + scan_job_events
Worker → appendProtectionEvent → protection_events
Alert evaluator → ops-alerts log + optional webhook
```

**Future:** Kafka/NATS — **architecture only**; Postgres outbox pattern if queue pressure &gt; 10k.

---

## Memory architecture

- **Write path:** Every verdict/review/fix/alert appends to `protection_events`.
- **Read path:** Snapshots precomputed daily (cron) for fast `what_changed` and charts.
- **Diff engine:** Compare snapshot N vs N-1 in application layer (V1); optimize with stored hashes later.

---

## Alert architecture

- **Product alerts:** security_notifications + email (protection triggers from doc 06).
- **Ops alerts:** health endpoint + `evaluateOperationalAlerts` (stuck jobs, failure rates).

**Scale:** Batching digest emails; idempotency keys per alert type + project + day.

---

## Continuous protection architecture

Inngest crons:

| Function | Schedule |
|----------|----------|
| daily_protection_check | Daily per active project (batched) |
| weekly_protection_summary | Weekly |
| monthly_protection_report | Monthly |
| scan-job-recovery | Every 5 min (existing) |

**Fan-out:** For 10k projects, use Inngest step batching (e.g. 100 projects/step)—not 10k separate crons.

---

## Security architecture

- GitHub tokens encrypted at rest (when key configured).
- MCP auth per user/org; no cross-org project access.
- RLS on user-readable tables.
- No secrets in logs, memory, or MCP responses.

---

## What we explicitly defer (no rewrite needed later)

| Component | When | Interface |
|-----------|------|-----------|
| Redis queue | &gt;10k concurrent jobs | Replace Inngest fan-out adapter |
| ClickHouse | &gt;50k analytics queries | Read from protection_events export |
| Fly workers | Long scans &gt;15m | Same job payload schema |
| Runtime agents | Year 2+ | `runtime_signal` table + API |

---

## Deployment topology (V1)

- **Vercel:** Next.js app + API routes + MCP + Inngest serve endpoint.
- **Supabase:** Postgres + Auth.
- **Inngest:** Cloud orchestration.
- **Stripe:** Billing.

---

## Capacity estimates (order of magnitude)

| Scale | Protected projects | Daily checks | Postgres writes/day |
|-------|-------------------|--------------|---------------------|
| 1k users | ~1.5k projects | 1.5k | ~50k events |
| 10k users | ~15k projects | 15k | ~500k events |
| 50k users | ~75k projects | 75k | ~2.5M events (snapshot strategy required) |

Hybrid V1 engineering must implement **daily snapshots** before 10k to keep diff queries fast.

---

## Relation to infra phases

Completed/near: async jobs, observability, recovery (Phase 1–1.6).  
Hybrid V1 product builds **on top**—no Phase 2 Redis/Kafka required for bible ship list.
