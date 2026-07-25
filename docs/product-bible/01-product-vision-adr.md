# ADR: SequrAI Product Vision

**Status:** Accepted  
**Date:** 2026-07-24  
**Supersedes:** All prior positioning as “AI security scanner,” “production verdict SaaS,” or “GitHub review tool.”  
**Scope:** Hybrid V1 and 6-month product freeze.

---

## Vision

**SequrAI is the autonomous production and protection layer for AI-built software.**

We exist so AI builders can ship and stay live without becoming security engineers, SREs, or compliance officers.

---

## Mission

**To continuously protect AI-built applications throughout their entire lifecycle.**

Protection starts before the first deploy and does not end after production traffic.

---

## Category

| We are | We are not |
|--------|------------|
| Continuous protection for AI-built apps | A cybersecurity company |
| Peace-of-mind infrastructure for founders | An AI code scanner |
| An autonomous production engineer in the IDE | A GitHub review bot |
| Protection + confidence, not findings lists | A DevSecOps platform |
| MCP-first product with a control-plane web app | A SOC dashboard |

**Category name (internal):** *Autonomous Production & Protection Layer (APPL)* for AI-built software.

---

## Customer

**Primary:** AI builders who use Cursor, Claude Code, Lovable, Bolt, Replit, and similar tools to build SaaS and indie products.

**Persona:** Founder / solopreneur / small startup (1–5 people). They understand product and AI-assisted coding. They do **not** want to learn CVE databases, WAF rules, or Kubernetes.

**Explicitly not Year 1:** Security engineers as buyers, enterprise procurement, Fortune 500, MSSPs, compliance-led sales.

---

## Product promise

```
Build with AI.
Protect continuously.
Deploy with confidence.
Stay protected.
```

**Commercial promise:** Users pay for **peace of mind**, not for “scans” or “reports.”

**Experience promise:** *“I don’t understand cybersecurity or production, but I completely trust SequrAI.”*

**Answer promise:** When the user asks *“Am I protected?”*, SequrAI answers with a clear **yes or not yet**, what would change the answer, and the next single action—never a wall of jargon.

---

## What we do

1. **Protect before deploy** — Review, confidence scores, deployment readiness, Safe Fix, clear “ready / not ready.”
2. **Protect after deploy** — Scheduled health checks, alerts, memory of the project, monthly protection summaries.
3. **Meet users in the IDE** — MCP as the primary interface; natural language protection workflows.
4. **Explain and fix** — Detect → explain → recommend → fix (with approval) → verify → protect again.
5. **Remember** — Production Memory so SequrAI gets smarter about *this* project over time.
6. **Alert only when it matters** — Actionable protection alerts, not noise.

---

## What we don’t do (Year 1)

- Sell “cybersecurity” or fear-based marketing.
- Darktrace-style runtime / network / infrastructure monitoring.
- Multi-cloud CSPM, WAF management, automatic production changes without approval.
- ML anomaly detection platforms.
- Enterprise SSO-heavy suites, on-prem, air-gapped.
- Replace Snyk/Sonar as a checkbox compliance tool.

We **design architecture** so these can exist later; we **do not ship** them in Hybrid V1.

---

## Long-term vision (5 years)

**Year 1 (Hybrid V1):** MCP-first protection for AI builders; continuous protection V1; memory; reports; approval-gated remediation.

**Years 2–3:** Deeper dependency and supply-chain signals; richer attack-surface evolution; team workflows for small startups; optional runtime *signals* (not full SIEM) where they clearly increase “Am I protected?” accuracy.

**Years 4–5:** Autonomous protection agents that coordinate review, fix, verify, and deploy gates across the AI builder stack—still founder-friendly, still peace-of-mind priced, still not enterprise cyber.

**Constant:** The north star remains **number of continuously protected AI-built applications**, not vulnerability counts.

---

## Design principles (non-negotiable)

1. **Apple / Cursor / Stripe / Linear / Vercel** — calm, precise, trustworthy UI and copy; not cyber dashboards.
2. **MCP is the product** — Web is onboarding, config, billing, metrics, protection dashboard.
3. **One plan Year 1** — Simple pricing; no plan matrix paralysis.
4. **No feature creep** — If it’s not in the Product Bible, it doesn’t ship.
5. **Founder language** — “Protected,” “confidence,” “worries,” “ready to ship”—not “CVSS,” “SIEM,” “attack chain.”

---

## Final recommendation test

**Question:** Would I confidently recommend SequrAI to a founder who built his SaaS with Cursor and is afraid of being hacked or deploying unsafe software?

**Answer (with Hybrid V1 as specified in this bible):** **YES.**

**Why:** He gets protection in the tool he already uses (MCP), a clear deploy gate (`can_i_deploy`), continuous checks after launch, memory so SequrAI knows his project, fixes with approval (Safe Fix), and monthly proof he stayed protected—without learning security.

**If any Hybrid V1 item slips** (continuous protection off by default, MCP setup > 60s, no “Am I protected?” answer), the answer becomes **NO** until the scope doc is satisfied.
