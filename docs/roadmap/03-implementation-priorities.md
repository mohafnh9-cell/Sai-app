# Implementation Priorities

**P0** — Blocks beta or NSM. **P1** — Required for SHIPS NOW before 1k users. **P2** — Polish within sprint if P0/P1 done. **STOP** — Not in Hybrid V1.

---

## P0 (must ship)

| Priority | Item | Sprint |
|----------|------|--------|
| P0 | Scan job reliability + Phase 1.6 prod cutover | S1 |
| P0 | Five MCP tools + founder voice + setup &lt;60s | S2 |
| P0 | Onboarding finale + Copy fix for Cursor | S2 |
| P0 | Memory append on every review + daily snapshots | S3 |
| P0 | CP default ON + daily check | S4 |
| P0 | Four protection statuses | S4 |
| P0 | Alerts material-only + dedupe | S5 |
| P0 | Safe Fix on NO-GO + verify (`fix_verified`) | S8 |
| P0 | Stripe single plan (beta billing) | S12 |
| P0 | Tenant isolation / RLS / no secrets in memory | S1–S3 |

---

## P1 (SHIPS NOW before 1,000 users)

| Priority | Item | Sprint |
|----------|------|--------|
| P1 | Weekly protection summary | S6 |
| P1 | Monthly Protection Report + email | S7 |
| P1 | MCP `what_changed` / `production_history` full parity | S3–S6 |
| P1 | Diff preview + approved PR | S9 |
| P1 | Protection Center v1 | S10 |
| P1 | Behaviour rules BD-01–07 | S5–S6 |
| P1 | Dependency monitoring V1 + attack surface evolution in reports | S11 |
| P1 | Production health composite + sparklines | S6–S10 |
| P1 | Rollback / revert detection | S8 |
| P1 | Monthly report open rate instrumentation | S7 |

---

## P2 (same sprint if capacity)

| Priority | Item | Sprint |
|----------|------|--------|
| P2 | PDF monthly export | S12 |
| P2 | Portfolio search (4+ projects) | S10 |
| P2 | Optional weekly email default ON | S12 |
| P2 | i18n beyond en core strings | S11–S12 |
| P2 | Referral program copy-only prep | S10 |

---

## STOP (do not implement in 6-month window)

From bible **BACKLOG** and architecture-only:

- Continuous real-time attack detection  
- Redis/Kafka/ClickHouse **as ship requirement**  
- Darktrace / WAF / cloud infra monitoring  
- Autonomous merge / prod hot-patch  
- MCP sixth+ tools  
- Enterprise SSO / SOC2 packs  
- ML behaviour detection  
- Production Memory cross-project AI  
- Slack alerts (unless promoted via amendment)  
- Phase 2 Fly workers (unless Vercel timeout proven)  

---

## Tradeoff rules

1. **MCP before dashboard** — web supports onboarding + Protection Center, not parallel workflow.  
2. **Snapshots before scale features** — no 10k load test before daily snapshots exist.  
3. **Alerts after CP** — protect noise budget.  
4. **Reports after memory** — no hand-written monthly content.  
5. **PR after prompt fix path** — Cursor-first founders first.

---

## Team focus split (suggested)

| Phase | Eng ~70% | GTM ~30% |
|-------|----------|----------|
| S1–S3 | Infra + memory | Cohort 0 interviews |
| S4–S6 | CP + alerts + weekly | **25 → 100** invites |
| S7–S9 | Reports + remediation | **100 → 300** |
| S10–S12 | UI + scale + billing | **300 → 500 → 1000** |

---

## Decision log template

Each sprint end:

- NSM count  
- P0 shipped Y/N  
- Cohort gate Y/N  
- Scope creep rejected (list)
