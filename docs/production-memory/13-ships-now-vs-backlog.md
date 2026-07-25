# SHIPS NOW vs BACKLOG

**Governance:** **No feature creep.** Memory work not listed under **SHIPS NOW** requires bible doc 03 amendment.

**Roadmap sprint:** Primary **S3**; extensions **S6–S11** ([../roadmap/07-feature-to-sprint-map.md](../roadmap/07-feature-to-sprint-map.md)).

---

## SHIPS NOW (Hybrid V1)

| Capability | Spec |
|------------|------|
| Append-only `protection_events` (full V1 catalog) | 01, 11 |
| Daily `protection_snapshots` + indexes | 11, 14 |
| `project_memory_profile` (tenure, counters, stack fingerprint) | 01, 11 |
| `protection_milestones` (sparse highlights) | 02, 08 |
| Protection / deployment / confidence / health histories | 02–07 |
| Recommendations lifecycle | 06 |
| 30-second timeline glance + Protection Center lite | 08, 09 |
| Portfolio status + one worry | 09 |
| MCP `production_history` + `what_changed` contracts | 10 |
| Daily / weekly / monthly update strategy | 12 |
| 12-month retention hot in Postgres | 11 |
| RLS + no secrets in payloads | 01 |
| Powers CP, alerts, reports, status, remediation verify | README |

---

## ARCHITECTURE ONLY (design hooks)

| Item | Purpose |
|------|---------|
| Cold archive &gt;12mo to object storage | Cost at 50k |
| Read replica DSN for MCP reads | Latency |
| `protection_events` monthly partitions | Write scale |
| Cross-project founder memory (opt-in) | Moat expansion |
| Embeddings on worries for similarity | Year 2 |
| Investor export API (PDF bundle) | GTM |
| Full engineer findings drawer backed by memory ids | UX depth |

**No user marketing until promoted.**

---

## BACKLOG (explicit non-goals)

| Item | Why |
|------|-----|
| Project history page / Jira-style activity feed | Not protection memory |
| Analytics warehouse / ClickHouse as ship req | Over-engineering |
| Raw git log mirror | Not our moat |
| MCP chat transcript memory | Privacy |
| ML “smart memory” training pipeline | V1 uses rules + counters |
| Unlimited retention on base plan | Pricing |
| Real-time streaming memory from prod logs | Not Year 1 |
| Memory as public API for third parties | Security |
| Sixth MCP tool for memory | Tool cap frozen |
| Per-finding immutable code snapshots | Secret risk |

---

## Feature creep examples (reject)

- “Show every CVE ever found” → use worries + verified fixes only  
- “Memory-powered A/B landing pages” → analytics  
- “Auto-close findings in memory without review” → breaks trust  

---

## Promotion checklist

1. Update this file + bible 03 + roadmap feature map.  
2. Load impact on [14-future-architecture-scaling.md](./14-future-architecture-scaling.md).  
3. UX review — still &lt;30s story?

---

## Supersedes

Legacy single doc: [11-future-architecture-and-scope.md](./11-future-architecture-and-scope.md) → split into **13** + **14**.
