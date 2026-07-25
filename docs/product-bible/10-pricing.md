# Pricing (Year One)

**Rule:** One public plan for 12 months. No plan confusion. Upgrade path designed but not sold until bible amendment.

---

## Plan name

**SequrAI Protection** (working title)

Tagline on checkout: *Continuous protection for your AI-built application.*

---

## Price

| | |
|---|---|
| **Monthly** | **$49 / month** |
| **Annual** | **$468 / year** ($39/mo effective — 20% off) |

**Rationale:** Below “real” DevSecOps tools, above hobby scanners—signals serious protection, affordable for indie founders. Adjust only with bible amendment + beta data.

---

## Included (everything in Hybrid V1 SHIPS NOW)

- Unlimited projects per account (fair use: ≤ 10 active repos; contact if more)
- MCP access (all five tools)
- Production Verdict + deploy readiness
- Safe Fix (prompt + PR flow)
- Continuous Protection (default ON)
- Daily checks + weekly summary + monthly report
- Security alerts (in-app + email)
- Production Memory + history in MCP
- GitHub integration
- English + Spanish product copy

**Not metered:** Number of reviews, MCP messages, or deploy checks (soft rate limits for abuse only).

---

## Free trial

- **14 days** full Protection plan.
- Credit card required at end of trial (or at signup—pick one in implementation; bible prefers **trial without card**, card on day 14).
- Trial projects get CP ON to demonstrate value.

---

## Upgrade strategy (Year 1)

**There is no upsell tier in Year 1.**

Growth levers:

- Annual prepay discount.
- Referral credit (architecture only: one month free per referred paying user—ship if time allows, else backlog).

---

## Future plans (architecture only — not sold)

| Plan | Audience | Adds |
|------|----------|------|
| **Protection Pro** | Small teams (5–10 seats) | Shared timeline, team alerts, multiple MCP keys |
| **Protection Scale** | Startups with compliance pressure | Audit export, SLA, priority queue |

Do not implement billing SKUs until post–Hybrid V1.

---

## Stripe implementation notes

- Single Product + single Price (monthly) + single Price (annual).
- Webhook: subscription status gates MCP + CP.
- Grace period: 3 days past_due before CP pauses (memory retained).

---

## Positioning at checkout

**Do say:** Peace of mind, continuous protection, deploy with confidence.  
**Do not say:** Vulnerability scanner, compliance, enterprise security.

---

## Success metric

- Trial → paid conversion ≥ 25% in beta.
- &lt; 5% support tickets about “what plan do I need?” (because there is one).
