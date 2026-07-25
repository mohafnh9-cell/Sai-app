# Project Health History Specification

**Definition:** Time series of **composite trust** — one health score and label summarizing production + security confidence, recency, and open pressure.

**Founder question answered:** *How healthy is my application overall?*

See formula: [../continuous-protection/05-production-health-specification.md](../continuous-protection/05-production-health-specification.md).

---

## Three health lenses (founder-facing)

Memory stores **one composite** plus **three readable labels** on each snapshot — not three unrelated products.

| Lens | Meaning | Derived from |
|------|---------|--------------|
| **Protection Health** | Is continuous protection working? | CP ON, recency, status, check streak |
| **Production Health** | Deploy readiness over time | Production confidence + production blockers trend |
| **Security Health** | Exposure over time | Security confidence + attack surface level |

| protection_health | Maps from status + streak |
|-------------------|---------------------------|
| Strong | PROTECTED + checks on time |
| Steady | SAFE WITH CAUTION |
| At risk | REQUIRES ATTENTION |
| Unwatched | NOT PROTECTED or CP paused |

**Health evolution:** Sparkline on composite `healthScore`; toggles show production vs security confidence (docs 04–05).

**Health trends:** 7d / 30d / lifetime (profile) — same numbers in timeline glance and MCP.

---

## What should be stored

### Daily snapshot fields (on `protection_snapshots`)

| Field | Type |
|-------|------|
| `healthScore` | 0–100 |
| `healthLabel` | Excellent / Good / Needs attention / At risk |
| `protectionStatus` | PROTECTED / SAFE WITH CAUTION / REQUIRES ATTENTION / NOT PROTECTED |
| `productionConfidence` | (also doc 04) |
| `securityConfidence` | (also doc 05) |
| `openCriticalHighCount` | Integer bucket for formula |
| `lastCheckAt` | Recency input |

### Event

`confidence_snapshot` payload includes health fields whenever snapshot written.

---

## What should never be stored

- Third-party uptime percentages (not V1)
- Synthetic “industry average” health
- Health score without underlying confidence samples (no orphan numbers)

---

## Label cap rule

If `protectionStatus` is **REQUIRES ATTENTION**, displayed `healthLabel` **cannot** be Excellent — max **Needs attention** (aligns CP doc 05).

Stored raw score may be higher; **display** applies cap.

---

## Founder experience

**Protection Center:** Subhead under sparkline:

```
Production health: Excellent
```

Toggle sparkline metric: Health score vs production confidence (default production).

**Quiet week:**

> *Health stayed Excellent all week.*

---

## MCP

| Question | Tool |
|----------|------|
| How healthy is my app? | `production_history` + `can_i_deploy` |
| Is health improving? | `production_history` | 

Include health label + 7d/30d delta on health score.

---

## Daily / weekly / monthly

| Cadence | Update |
|---------|--------|
| Daily | Recompute on snapshot job |
| Weekly | health start/end in weekly summary |
| Monthly | “Production Health: {label}” in report template |

---

## Relationship to other histories

| History | Role |
|---------|------|
| Production confidence | 35% weight |
| Security confidence | 35% weight |
| Recency | 15% |
| Open critical/high | 15% |
| Protection status | Qualitative guardrail on label |

---

## Acceptance criteria

- Health reproducible from fixture inputs.
- MCP health label matches Protection Center for same snapshot id.
- History retention ≥ 12 months for sparkline export.
