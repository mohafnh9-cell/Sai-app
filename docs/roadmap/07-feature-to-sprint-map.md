# Feature-to-Sprint Map (SHIPS NOW)

Every **SHIPS NOW** item from [03-hybrid-v1-scope.md](../product-bible/03-hybrid-v1-scope.md) assigned to exactly one primary sprint.  
**No feature outside this table.**

---

## Layer 1 — Protection before deploy

| Feature | Sprint | Notes |
|---------|--------|-------|
| Production Verdict | S2 (MCP) + existing engine | Formatter/copy |
| Security / Production / Reliability / AI reviews | Existing + S2 copy | Domains unchanged |
| Deployment + Security confidence | S2 MCP + S6 charts | |
| Attack Surface V1 | Existing + S11 evolution in reports | |
| Safe Fix prompt | S2 copy + **S8** hero | |
| Review again | S2 MCP + **S8** after_fix | |
| MCP V1 (5 tools) | **S2** | |
| Web control plane | S2 onboarding + **S10** Protection Center | |

---

## Layer 2 — Continuous protection

| Feature | Sprint |
|---------|--------|
| CP toggle default ON | **S4** |
| Daily protection check | **S4** |
| Weekly protection summary | **S6** |
| Monthly Protection Report | **S7** |
| Security alerts V1 | **S5** |
| Production health V1 | **S6**–**S10** |
| Dependency monitoring V1 | **S11** |
| Attack surface evolution V1 | **S11** |
| Behaviour detection V1 | **S5**–**S6** |
| Async job pipeline | **S1** |

---

## Layer 3 — Production Memory

| Feature | Sprint |
|---------|--------|
| Project timeline | **S3** + **S10** lite |
| Confidence history | **S3** snapshot + **S6** sparkline |
| Recommendations history | **S3** + **S8** |
| `what_changed` / `production_history` | **S3** minimal → **S6** full |

---

## Layer 4 — Auto remediation

| Feature | Sprint |
|---------|--------|
| Detect → Explain | **S2** verdict copy |
| Recommend → Fix | **S8** |
| Diff preview | **S9** |
| PR generation | **S9** |
| Verify | **S8** |
| Rollback | **S8** |

---

## Go-to-market

| Feature | Sprint |
|---------|--------|
| One pricing plan (Stripe) | **S12** |
| Beta cohorts 25→1k | **S4–S12** per [05-beta-milestones](./05-beta-milestones.md) |
| Positioning copy | **S2**, refresh **S12** |

---

## Explicitly NOT on roadmap (ARCHITECTURE ONLY / BACKLOG)

| Item | Status |
|------|--------|
| Redis/Kafka/ClickHouse ship | BACKLOG / hooks only S11 |
| Runtime signal ingestion | ARCHITECTURE ONLY |
| ML behaviour | BACKLOG |
| MCP sixth tool | BACKLOG |
| Slack alerts | BACKLOG |
| SSO / enterprise | BACKLOG |
| Public launch | After R13 |
| Continuous Protection as separate product SKU | N/A — single plan |

---

## Sprint workload summary

| Sprint | Feature count (primary) |
|--------|-------------------------|
| S1 | 1 (jobs) |
| S2 | 8 (MCP + UX + explain) |
| S3 | 5 (memory) |
| S4 | 4 (CP core) |
| S5 | 3 (alerts + behaviour) |
| S6 | 4 (weekly + health + history) |
| S7 | 2 (monthly) |
| S8 | 6 (remediation core) |
| S9 | 3 (diff + PR) |
| S10 | 4 (Protection Center) |
| S11 | 4 (scale + deps + surface) |
| S12 | 3 (billing + polish + 1k) |

---

## Verification

Before marking sprint done:

```text
For each row in this table for sprint Sx:
  [ ] Shipped to staging
  [ ] Acceptance criteria from bible doc 03 met
  [ ] Metrics from 04-success-metrics.md sprint row green
```

---

## Amendment

Adding a row requires bible doc 03 + this file + sprint dates in [01-timeline-and-sprints.md](./01-timeline-and-sprints.md).
