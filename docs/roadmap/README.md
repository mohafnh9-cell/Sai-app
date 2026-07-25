# SequrAI Hybrid V1 — 6-Month Implementation Roadmap

**Effective:** 2026-07-24 → **2027-01-24**  
**Scope:** [Product Bible SHIPS NOW](../product-bible/03-hybrid-v1-scope.md) only.  
**Governance:** **No feature may be implemented outside this roadmap** unless the roadmap and bible doc 03 are amended together.

**Mission:** Ship **continuously protected AI-built applications** via MCP-first experience, ending in **Private Beta USA** at **1,000 users**.

---

## Documents

| Doc | Purpose |
|-----|---------|
| [01-timeline-and-sprints.md](./01-timeline-and-sprints.md) | Month-by-month + sprint calendar (S1–S12) |
| [02-dependencies-and-build-order.md](./02-dependencies-and-build-order.md) | Dependency graph + strict build sequence |
| [03-implementation-priorities.md](./03-implementation-priorities.md) | P0/P1/P2 and what not to build |
| [04-success-metrics.md](./04-success-metrics.md) | NSM, activation, quality, sprint gates |
| [05-beta-milestones.md](./05-beta-milestones.md) | **25 → 100 → 300 → 500 → 1,000** gates |
| [06-release-milestones.md](./06-release-milestones.md) | Staging, prod cutover, cohort opens |
| [07-feature-to-sprint-map.md](./07-feature-to-sprint-map.md) | Every SHIPS NOW item → sprint |

**Design references (docs only, pre-sprint):**  
[MCP](../mcp-product/README.md) · [UX](../ux-sprint/README.md) · [CP](../continuous-protection/README.md) · [Memory](../production-memory/README.md) · [Alerts](../security-alerts/README.md) · [Reports](../protection-reports/README.md) · [Remediation](../auto-remediation/README.md) · [Architecture](../hybrid-v1-architecture/README.md)

---

## End state (Jan 2027)

```
Private Beta USA
  25 users  →  100  →  300  →  500  →  1,000 users
```

After **1,000**: criteria for **public launch** per [beta strategy](../product-bible/11-beta-strategy.md) — not in this 6-month build window unless accelerated.

---

## One-page sprint order

| Sprint | Dates (approx) | Theme | Beta gate |
|--------|----------------|-------|-----------|
| **S1** | Jul 24 – Aug 6 | Staging GO + jobs hardening | Internal |
| **S2** | Aug 7 – Aug 20 | MCP voice + UX onboarding finale | Internal |
| **S3** | Aug 21 – Sep 3 | Production Memory writes + snapshots | Internal |
| **S4** | Sep 4 – Sep 17 | Continuous Protection daily + status | **Open 25** |
| **S5** | Sep 18 – Oct 1 | Alerts V1 + behaviour rules | 25 hold |
| **S6** | Oct 2 – Oct 15 | Weekly summary + `what_changed` / history | **Open 100** |
| **S7** | Oct 16 – Oct 29 | Monthly report + email archive | 100 hold |
| **S8** | Oct 30 – Nov 12 | Safe Fix UX + verify loop | **Open 300** |
| **S9** | Nov 13 – Nov 26 | PR approval remediation | 300 hold |
| **S10** | Nov 27 – Dec 10 | Protection Center + health charts | **Open 500** |
| **S11** | Dec 11 – Dec 24 | Scale phase 1 (10k prep) + deps V1 | 500 hold |
| **S12** | Dec 25 – Jan 24 | Polish, billing, **Open 1,000** | **1,000** |

---

## North star (unchanged)

**Continuously protected applications** — definition: [north star doc](../product-bible/12-north-star-metrics.md).

---

## Final rule

If it is not in:

1. [03-hybrid-v1-scope.md](../product-bible/03-hybrid-v1-scope.md) **SHIPS NOW**, and  
2. This roadmap sprint map ([07-feature-to-sprint-map.md](./07-feature-to-sprint-map.md)),  

→ **Do not implement.**
