# Beta Strategy

**Goal:** Grow **continuously protected applications**, not signups alone.

**Cohort ladder:**

```
25 → 100 → 300 → 500 → 1,000 users
```

Each gate requires **success criteria** before opening the next cohort.

---

## Cohort 0 — Internal (now)

- Team + friendly founders.
- Validate MCP setup &lt; 60s, first verdict &lt; 2 min.

---

## Cohort 1 — 25 users

**Profile:** Cursor-first AI builders with live or near-live SaaS.

**Access:** Invite-only; waitlist form.

**Focus:**

- MCP as primary workflow.
- Continuous protection default ON.
- Monthly report template.

**Activation metrics (per user within 7 days):**

| Metric | Target |
|--------|--------|
| GitHub connected | 100% |
| First `review_now` or `can_i_deploy` success | ≥ 90% |
| Continuous protection enabled | ≥ 85% |
| Second MCP session (WAU) | ≥ 70% |

**Retention (30 days):**

| Metric | Target |
|--------|--------|
| Paid conversion (if trial ended) | ≥ 25% |
| MCP WAU / MAU | ≥ 50% |
| Projects still protected (CP ON) | ≥ 80% |

**Exit criteria to 100:** All targets met for 2 consecutive weeks; P0 incident count = 0.

---

## Cohort 2 — 100 users

**Add:** Weekly founder calls (5 users); in-app NPS.

**MCP adoption metrics:**

| Metric | Target |
|--------|--------|
| MCP-first users (% first action via MCP) | ≥ 60% |
| Avg MCP sessions / WAU | ≥ 3 |
| `can_i_deploy` uses / WAU | ≥ 1 |

**Protection metrics:**

| Metric | Target |
|--------|--------|
| Unsafe deploys prevented (logged NO-GO) | Track baseline |
| Safe Fix invoked | ≥ 20% of NO-GO users |

**Exit to 300:** Churn &lt; 8% monthly; support load &lt; 2 hrs/day.

---

## Cohort 3 — 300 users

**Add:** Self-serve waitlist → auto-invite when capacity allows.

**Stress:** Async job queue, daily checks at scale.

**Success criteria:**

| Metric | Target |
|--------|--------|
| Daily check success rate | ≥ 99% |
| Alert false positive rate | &lt; 5% |
| Time to first verdict P95 | &lt; 2 min |

**Exit to 500:** Infra Phase 1.6 production cutover **GO**; no stuck-job P0s for 14 days.

---

## Cohort 4 — 500 users

**Add:** Referral program (if ready); content marketing “Build with AI, stay protected.”

**Focus:** Monthly report engagement ≥ 40% open rate.

---

## Cohort 5 — 1,000 users

**Public launch** (out of private beta).

**Success criteria for public launch:**

- North star: ≥ 1,200 **continuously protected applications** (some users multi-project).
- MCP WAU ≥ 400.
- NPS ≥ 40 among founders.

---

## Channels (priority)

1. Cursor community + MCP directory
2. Indie Hackers / X founder audience
3. Claude Code MCP setup docs
4. Not: enterprise security conferences

---

## Support model

- Async email + docs; no 24/7 SOC.
- Founders get protection language, not CVE lectures.

---

## Kill criteria (pause growth)

- Production data loss.
- Cross-tenant leak.
- &gt; 5% daily check failure for 48h.
- Legal/trust incident.

Pause invites until fixed + postmortem.

---

## Beta success definition

Beta succeeds when a **Cursor founder** says: *“I don’t know security, but I know SequrAI has my back before and after deploy.”*

Quantified by NPS + qualitative interviews (≥ 10) at 100 users.
