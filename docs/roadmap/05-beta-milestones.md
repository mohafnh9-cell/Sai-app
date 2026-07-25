# Beta Milestones — Private Beta USA

**Ladder (mandatory order):**

```
25 users → 100 users → 300 users → 500 users → 1,000 users
```

**Region:** USA private beta (invite-only) unless bible amended.  
**Strategy detail:** [11-beta-strategy.md](../product-bible/11-beta-strategy.md).

---

## Cohort 0 — Internal (pre-25)

**When:** Before S4 prod CP.  
**Who:** Team + 3–5 friendly founders.

**Exit:** MCP &lt;60s setup; verdict &lt;2m P95; no P0 security issues.

---

## Cohort 1 — 25 users

**Open:** End of **S4** (Continuous Protection daily live in prod).

**Profile:** Cursor-first AI builders; live or near-live SaaS.

**Focus:** MCP primary; CP default ON; first monthly template can be manual HTML until S7.

| Gate (7-day activation) | Target |
|-------------------------|--------|
| GitHub connected | 100% |
| First review / can_i_deploy success | ≥ 90% |
| CP ON | ≥ 85% |
| Second MCP session | ≥ 70% |

| Gate (30-day) | Target |
|---------------|--------|
| Paid conversion (if trial) | ≥ 25% |
| MCP WAU/MAU | ≥ 50% |
| CP still ON | ≥ 80% |

**Exit to 100:** All targets **2 consecutive weeks**; P0 incidents = 0.

**Roadmap sprints required:** S1–S5 minimum (alerts live before scaling to 100).

---

## Cohort 2 — 100 users

**Open:** After **S6** weekly summary + cohort 1 exit.

**Add:** 5 founder calls/cycle; in-app NPS.

| Metric | Target |
|--------|--------|
| MCP-first first action | ≥ 60% |
| MCP sessions / WAU | ≥ 3 |
| can_i_deploy / WAU | ≥ 1 |
| Safe Fix on NO-GO | ≥ 20% |

**Exit to 300:** Monthly churn &lt;8%; support &lt;2 hr/day.

**Required:** S6 weekly; S7 monthly shipping or soft-launch monthly at 100.

---

## Cohort 3 — 300 users

**Open:** After **S8** verify loop + cohort 2 exit.

**Stress:** Daily checks at volume; async queue.

| Metric | Target |
|--------|--------|
| Daily check success | ≥ 99% |
| Alert false positives | &lt; 5% |
| Verdict P95 | &lt; 2 min |

**Exit to 500:** Phase 1.6 prod cutover **GO**; no stuck-job P0 for **14 days**.

**Required:** S7 monthly live; S8 Safe Fix + verify.

---

## Cohort 4 — 500 users

**Open:** After **S10** Protection Center + cohort 3 exit.

**Focus:** Monthly report open ≥ 40%; referral prep optional.

| Metric | Target |
|--------|--------|
| Monthly report open rate | ≥ 40% |
| NSM / total projects | ≥ 70% |
| NPS (founders) | ≥ 35 |

**Exit to 1000:** S11 scale checklist complete; Stripe billing stable.

---

## Cohort 5 — 1,000 users

**Open:** End of **S12** (roadmap end).

**Cap:** 1,000 private beta users — waitlist pauses.

| Metric | Target |
|--------|--------|
| Continuously protected applications | ≥ 1,200 |
| MCP WAU | ≥ 400 |
| NPS | ≥ 40 |

**After 1,000:** Public launch decision — separate gate in beta strategy (out of 6-month build unless pulled forward).

---

## Kill criteria (any cohort)

Pause invites if:

- Production data loss  
- Cross-tenant leak  
- &gt;5% daily check failure for 48h  
- Legal/trust incident  

Resume only after fix + postmortem.

---

## Beta success (qualitative)

≥10 interviews at 100 users:

> *“I don’t know security, but SequrAI has my back before and after deploy.”*

---

## Timeline alignment

| Users | Target open (sprint) |
|-------|----------------------|
| 25 | S4 (~ mid Sep 2026) |
| 100 | S6 (~ mid Oct 2026) |
| 300 | S8 (~ early Nov 2026) |
| 500 | S10 (~ early Dec 2026) |
| 1,000 | S12 (~ mid Jan 2027) |

Dates slip if **exit criteria** not met — do not skip cohorts.
