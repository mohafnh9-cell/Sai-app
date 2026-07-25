# Hybrid V1 Technical Architecture

**Sprint scope:** Design only — **no implementation.**

**Mission:** Scale **1k → 10k → 50k** users on **Vercel + Postgres (Supabase) + Inngest + existing Next.js stack** — **without a rewrite** and **without enterprise bloat**.

**Bible summary:** [../product-bible/09-technical-architecture.md](../product-bible/09-technical-architecture.md)  
**Not Hybrid V1 ship:** Redis/Kafka/ClickHouse/Fly as **requirements** — extension points only ([09-future-architecture-specification.md](./09-future-architecture-specification.md)).

## Principles

1. **MCP edge, Postgres truth** — durable state in Postgres; MCP stateless.  
2. **Jobs for slow work** — scans/reviews via Inngest + `scan_jobs`.  
3. **Idempotent side effects** — verdicts, memory, alerts, PRs.  
4. **Tenant isolation** — org scope + RLS.  
5. **Snapshots before scale** — daily `protection_snapshots` before 10k projects.  
6. **Extension points, not premature infra** — same job payloads when workers split later.

## Documents

| # | Area | File |
|---|------|------|
| — | System context | [00-system-context.md](./00-system-context.md) |
| 1 | MCP | [01-mcp-architecture.md](./01-mcp-architecture.md) |
| 2 | Continuous Protection | [02-continuous-protection-architecture.md](./02-continuous-protection-architecture.md) |
| 3 | Memory | [03-memory-architecture.md](./03-memory-architecture.md) |
| 4 | Events | [04-event-architecture.md](./04-event-architecture.md) |
| 5 | Alerts | [05-alerts-architecture.md](./05-alerts-architecture.md) |
| 6 | Monthly reports | [06-monthly-reports-architecture.md](./06-monthly-reports-architecture.md) |
| 7 | Auto remediation | [07-auto-remediation-architecture.md](./07-auto-remediation-architecture.md) |
| 8 | Database | [08-database-architecture.md](./08-database-architecture.md) |
| 9 | Future architecture | [09-future-architecture-specification.md](./09-future-architecture-specification.md) |
| 10 | Scaling strategy | [10-scaling-strategy.md](./10-scaling-strategy.md) |

## Product layer specs (behavior)

| Layer | Doc pack |
|-------|----------|
| MCP product | [../mcp-product/README.md](../mcp-product/README.md) |
| Continuous Protection | [../continuous-protection/README.md](../continuous-protection/README.md) |
| Memory | [../production-memory/README.md](../production-memory/README.md) |
| Alerts | [../security-alerts/README.md](../security-alerts/README.md) |
| Reports | [../protection-reports/README.md](../protection-reports/README.md) |
| Auto remediation | [../auto-remediation/README.md](../auto-remediation/README.md) |

## Deployment topology (V1)

| Component | Provider |
|-----------|----------|
| App + API + MCP | Vercel (Next.js) |
| Postgres + Auth | Supabase |
| Workflow cron / fan-out | Inngest Cloud |
| Email | Resend or equivalent (existing) |
| Billing | Stripe |
| GitHub | GitHub App |

## Success criterion

Hybrid V1 remains a **founder product** at 50k users: same five MCP tools, same protection story, same stack class — only **horizontal batching, indexes, and read paths** tighten.
