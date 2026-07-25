# Scaling Strategy (Hybrid V1)

**Goal:** 1k → 10k → 50k **without rewrite** — progressive **tightening**, not new product tier.

---

## Scale model (assumptions)

| | 1k users | 10k users | 50k users |
|---|----------|-----------|-----------|
| Active projects | ~1.5k | ~15k | ~75k |
| Daily CP checks | ~1.5k | ~15k | ~75k |
| MCP calls/day | ~50k | ~500k | ~2.5M |
| Memory events/day | ~50k | ~500k | ~2.5M |

One user ≈ 1–2 projects average for planning.

---

## Phase 0 — Ship Hybrid V1 (0 → 1k)

**Do first:**

- [ ] Daily `protection_snapshots` + indexes  
- [ ] Inngest CP batch fan-out (design in doc 02)  
- [ ] Alert dedupe keys  
- [ ] MCP idempotency on `review_now`  
- [ ] Org scan concurrency = 3  
- [ ] Health + ops alerts (Phase 1.5)

**Do not:** Redis, second DB, worker fleet.

**Success:** P95 MCP `can_i_deploy` &lt; 800ms; daily checks &gt;99% complete.

---

## Phase 1 — Grow (1k → 10k)

**Add:**

| Lever | Effort |
|-------|--------|
| Verdict/snapshot read cache (Postgres or KV) | Low |
| Per-org MCP rate limits | Low |
| PgBouncer transaction mode | Config |
| CP incremental SHA skip | Already designed |
| `protection_events` monthly partitions | Medium |
| Email outbox table | Medium |

**Watch metrics:**

- Postgres CPU / connection count  
- Inngest function concurrency  
- scan job queue wait p95 (&lt;2m ops target)  
- Founder alert noise_rate (&lt;5%)

**Success:** No MCP protocol change; no customer-facing “enterprise tier.”

---

## Phase 2 — Scale (10k → 50k)

**Add:**

| Lever | Effort |
|-------|--------|
| Postgres **read replica** for MCP read tools | Medium |
| Stagger daily CP by project hash | Low |
| Report HTML → blob storage | Medium |
| Archive events &gt;12mo to object storage | Medium |
| Optional MCP-only Vercel deployment | Low (routing) |
| Inngest step batch size tuning (100→200) | Low |

**Consider (only if measured need):**

- Fly worker for long scans — **same job payload**  
- Redis for distributed rate limit — **not** for queue V1  

**Success:** Memory diff p95 &lt;1s; monthly job completes &lt;6h for all projects.

---

## Bottleneck playbook

| Symptom | First fix | Not first fix |
|---------|-----------|---------------|
| Slow `production_history` | Snapshots + replica | ClickHouse |
| Job backlog | Batch CP; raise worker concurrency cap | Kafka |
| GitHub rate limits | Cache SHAs; reduce redundant scans | New GitHub App per user |
| Email bounces | Cap per day | Separate product |
| Vercel timeout on scan | Async Inngest only | Rewrite scanner |

---

## Cost discipline (founder product)

- Prefer **skip work** (unchanged SHA) over **more hardware**.  
- Prefer **Postgres** over new SaaS until line item &gt;10% infra budget.  
- LLM: cap tokens per fix/review — scope limits in auto-remediation.

---

## Testing scale

| Test | When |
|------|------|
| Staging load script ([../operations/staging-load-testing.md](../operations/staging-load-testing.md)) | Pre-10k |
| Synthetic 15k project batch enqueue | Pre-10k |
| MCP read soak on replica | Pre-50k |

---

## Non-goals at every tier

- Multi-cloud active-active  
- Per-tenant isolation DB  
- Self-hosted SequrAI  
- Unlimited retention without pricing change  

---

## Success criterion (mission)

> Hybrid V1 scales cleanly **without becoming an enterprise product.**

Interpretation:

- Same pricing story (single plan bible).  
- Same five MCP tools.  
- Same founder UX — only faster/more reliable.  
- Enterprise features stay backlog until GTM changes.

---

## Related docs

- [README.md](./README.md)  
- All `01`–`09` architecture docs  
- [../product-bible/12-north-star-metrics.md](../product-bible/12-north-star-metrics.md)
