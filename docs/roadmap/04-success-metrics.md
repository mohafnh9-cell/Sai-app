# Success Metrics (Roadmap)

**North star:** [12-north-star-metrics.md](../product-bible/12-north-star-metrics.md) — **continuously protected applications**.

---

## Global Hybrid V1 targets (Jan 2027)

| Metric | Target |
|--------|--------|
| Continuously protected applications | ≥ 1,200 (at 1k users, multi-project) |
| MCP WAU | ≥ 400 |
| Median production + security confidence (protected) | ≥ 85 |
| Alert false positive rate | &lt; 5% |
| Daily CP check success | ≥ 99% |
| MCP setup → first tool success | &lt; 60s |
| First verdict P95 | &lt; 2 min |
| NO-GO → Safe Fix within 7d | ≥ 30% |
| Opened PR → verify within 14d | ≥ 50% |
| Monthly report open rate | ≥ 40% |
| Cross-tenant incidents | 0 |

---

## Per-sprint exit metrics

| Sprint | Exit criteria |
|--------|---------------|
| **S1** | Staging soak GO; stuck jobs 0 &gt;15m; `release:verify` pass |
| **S2** | MCP intent eval thresholds; onboarding E2E without broken i18n |
| **S3** | 100% reviews → memory; `what_changed` 90% meaningful (2+ snapshots) |
| **S4** | CP ON ≥85% new projects; daily completion ≥99% staging |
| **S5** | noise_rate &lt;5%; inbox dedupe tests pass |
| **S6** | Weekly card delivered 99%; MCP history matches card |
| **S7** | Monthly email dedupe; golden report test |
| **S8** | fix_verified rules correct; Safe Fix on all NO-GO heroes |
| **S9** | Zero unapproved PRs; zero duplicate PRs/finding |
| **S10** | Status hero matches MCP same snapshotId |
| **S11** | 10k-project enqueue dry run completes; dep advisory path live |
| **S12** | Stripe live; 1k cap enforced; kill criteria doc published |

---

## Activation (every cohort)

Within **7 days** of signup:

| Metric | Target |
|--------|--------|
| GitHub connected | 100% |
| First MCP or web verdict success | ≥ 90% |
| CP enabled | ≥ 85% |
| Second MCP session (WAU) | ≥ 70% |

---

## Retention (30-day)

| Metric | Target |
|--------|--------|
| Projects CP still ON | ≥ 80% |
| MCP WAU/MAU | ≥ 50% |
| Paid retention (post-trial) | ≥ 75% |

---

## Quality guardrails (any sprint — pause beta if breached)

| Metric | Threshold |
|--------|-----------|
| Daily check failure | &gt;5% for 48h → pause invites |
| Cross-tenant leak | Any → pause + postmortem |
| Duplicate side effects | &gt;0 → P0 stop ship |
| Data loss | Any → kill criteria |

---

## Reporting

| Audience | Cadence |
|----------|---------|
| Eng | Daily job health; weekly NSM |
| Product | Weekly cohort funnel |
| Beta users | Monthly Protection Report (product) |

---

## Sprint review checklist

- [ ] NSM delta vs last week  
- [ ] Guardrails green  
- [ ] Cohort exit criteria (if sprint overlaps gate)  
- [ ] No scope shipped outside [07-feature-to-sprint-map](./07-feature-to-sprint-map.md)
