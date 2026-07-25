# Timeline and Sprints (6 Months)

**Window:** 2026-07-24 → 2027-01-24 (**12 two-week sprints**).

---

## Month overview

| Month | Calendar | Engineering focus | GTM |
|-------|----------|-------------------|-----|
| **M1** | Jul–Aug 2026 | Infra cutover, MCP copy, onboarding UX | Internal / Cohort 0 |
| **M2** | Aug–Sep 2026 | Memory + CP daily | Prep 25 |
| **M3** | Sep–Oct 2026 | Alerts + weekly | **25 → 100** |
| **M4** | Oct–Nov 2026 | Monthly reports + fix loop | **100 → 300** |
| **M5** | Nov–Dec 2026 | PR remediation + Protection Center | **300 → 500** |
| **M6** | Dec 2026–Jan 2027 | Scale + polish + Stripe | **500 → 1,000** |

---

## Sprint detail

### S1 — Staging GO & job reliability (P0)

**Outcomes:**

- Phase 1.6 staging scenarios A–L executed; soak documented  
- `release:verify` green on Node 22  
- Production cutover checklist ready; Inngest async default for allowlisted orgs → prod  
- Ops alerts wired (existing Phase 1.5)

**Docs:** [operations/phase1-6](../operations/), [hybrid-v1-architecture/10-scaling](../hybrid-v1-architecture/10-scaling-strategy.md) Phase 0

**Gate:** No cohort open until daily job success ≥99% in staging 7 days.

---

### S2 — MCP experience + onboarding UX (P0)

**Outcomes:**

- MCP: response formatters + client instructions + tool descriptions per [mcp-product](../mcp-product/README.md)  
- UX: onboarding finale, **Copy fix for Cursor**, Connect Cursor step per [ux-sprint](../ux-sprint/README.md)  
- Intent eval dataset rows for CP phrases  
- **Five tools only** — no additions

**Gate:** MCP setup → first tool success &lt;60s (staging users).

---

### S3 — Production Memory foundation (P0)

**Outcomes:**

- `protection_events` append + core types (review, verdict, deploy, safe_fix)  
- `protection_snapshots` daily rollup job skeleton  
- `protection_recommendations` + `protection_deployments`  
- MCP `what_changed` + `production_history` read paths (minimal narrative)

**Docs:** [production-memory](../production-memory/README.md), [hybrid-v1-architecture/03](../hybrid-v1-architecture/03-memory-architecture.md)

**Gate:** 100% reviews write memory; `what_changed` works for 2+ snapshot projects.

---

### S4 — Continuous Protection daily (P0) · **Beta 25**

**Outcomes:**

- CP default ON; toggle + pause copy  
- Inngest `cp-daily-batch` + incremental SHA path  
- Status machine v1 (four states)  
- Material change → memory (alerts in S5)

**Docs:** [continuous-protection](../continuous-protection/README.md)

**Release:** **Private Beta USA — 25 users** (invite-only).

---

### S5 — Security alerts V1 (P0)

**Outcomes:**

- Alert evaluator + dedupe + in-app inbox  
- Email optional (off default for 25)  
- Behaviour rules BD-01–BD-07 (batch where weekly)

**Docs:** [security-alerts](../security-alerts/README.md)

**Gate:** noise_rate &lt;5% in staging synthetic load.

---

### S6 — Weekly protection summary (P1) · **Beta 100**

**Outcomes:**

- Weekly aggregator + in-app card  
- MCP `production_history` parity with weekly narrative  
- Confidence trends in UI (sparkline v1)

**Docs:** [protection-reports/02](../protection-reports/02-weekly-protection-reports-specification.md)

**Release:** **100 users** if [05-beta-milestones](./05-beta-milestones.md) cohort 1 exit met.

---

### S7 — Monthly Protection Report (P1)

**Outcomes:**

- Monthly job + email + archive  
- Statistics block from Memory  
- Alert rollup section (no re-fire)

**Docs:** [protection-reports/01](../protection-reports/01-monthly-protection-reports-specification.md)

**Gate:** Report generated with zero manual edits (fixture tests).

---

### S8 — Auto remediation prompt + verify (P0) · **Beta 300**

**Outcomes:**

- Safe Fix Tier-1 card everywhere NO-GO  
- `review_now` after_fix + `fix_verified` memory  
- Rollback detection on review

**Docs:** [auto-remediation/01,05,06](../auto-remediation/README.md)

**Release:** **300 users** if infra + alert gates met.

---

### S9 — Diff preview + PR approval (P1)

**Outcomes:**

- Scoped diff preview  
- Approve and open PR + audit fields  
- Async GitHub PR job

**Docs:** [auto-remediation/02–04](../auto-remediation/README.md)

**Non-goal:** auto-merge.

---

### S10 — Protection Center (P1) · **Beta 500**

**Outcomes:**

- Hero status + worries + recommendation + timeline lite  
- Reports archive UI  
- Portfolio badges (four states)

**Docs:** [continuous-protection/08](../continuous-protection/08-protection-center-specification.md), [memory UX](../production-memory/09-memory-ux-specification.md)

**Release:** **500 users**.

---

### S11 — Scale & dependency V1 (P1)

**Outcomes:**

- CP batch tuning; snapshot indexes; optional event partition plan executed if metrics warrant  
- Dependency monitoring V1 (lockfile + critical advisory)  
- Attack surface evolution in weekly/monthly  
- Per-org MCP rate limits (Postgres counter first)

**Docs:** [hybrid-v1-architecture/10](../hybrid-v1-architecture/10-scaling-strategy.md) Phase 1

---

### S12 — Polish & **Beta 1,000** (P0 GTM)

**Outcomes:**

- Stripe single plan live; beta invite automation  
- Landing positioning sprint complete  
- PDF monthly optional  
- Load test 10k-project enqueue dry run  
- Kill criteria runbooks published

**Release:** **Private Beta USA — 1,000 users** (cap).

**End of Hybrid V1 roadmap window.**

---

## Parallel work (allowed)

| Track | Sprints |
|-------|---------|
| Copy/i18n | S2–S12 continuous |
| Ops / on-call | S1+ |
| MCP eval | S2, S6, S12 |
| Docs / support | S4+ |

**Not allowed parallel:** New SHIPS NOW features not in [07-feature-to-sprint-map.md](./07-feature-to-sprint-map.md).
