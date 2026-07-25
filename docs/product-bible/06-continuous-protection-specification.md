# Continuous Protection Specification

**Scope:** Hybrid V1 continuous protection without Darktrace, runtime SIEM, or infrastructure monitoring.

**Expanded design (workflows, UX, MCP, Protection Center, rules):** [../continuous-protection/README.md](../continuous-protection/README.md).

**Daily question SequrAI answers:** Is this app healthy? Less secure than before? What changed? New vulnerabilities? Growing attack surface? Ready for production? Production issues? What should worry the founder?

---

## Core concept

**Continuous Protection** = scheduled re-evaluation of protection status using the same engines as Layer 1, plus diffs vs Production Memory, plus rule-based behaviour signals.

Default: **ON** when a project has GitHub connected and a successful first review.

---

## Cadences

| Cadence | Job type | User-visible output |
|---------|----------|---------------------|
| **Daily** | Lightweight protection check | Alert only if material change |
| **Weekly** | Summary aggregation | In-app + optional email |
| **Monthly** | Full Protection Report | Email + dashboard archive |
| **On push** (optional V1) | Webhook-triggered review | If repo has auto-review enabled |

**Material change (daily alert):**

- New critical/high finding.
- Security or production confidence drop ≥ 10 points.
- Attack surface level increases (e.g. LOW → MED).
- New dependency with critical advisory (V1 ecosystem scope).

Non-material changes are logged to Memory only.

---

## Daily reviews

- **Input:** Latest default branch HEAD vs last reviewed SHA.
- **Action:** Incremental or full review per cost guardrails.
- **Output:** Memory event `daily_check_completed` or `daily_check_material_change`.
- **No alert:** Silent success (peace of mind).

---

## Weekly reviews

- **Content:**
  - Protection status (protected / not yet)
  - Confidence trend (7-day)
  - Top 3 worries (current)
  - Changes since last week (`what_changed` summary)
  - Recommended action (single)

---

## Monthly Protection Reports

Template (required sections):

```
SEQURAI MONTHLY REPORT — {Project} — {Month}

Production Confidence: {n}%
Security Confidence: {n}%
Attack Surface: {LOW|MED|HIGH}

Production Issues Prevented: {n}      (inferred from NO-GO deploy attempts / blocked recommendations)
Unsafe Deployments Prevented: {n}   (can_i_deploy NO-GO logged)
Critical Issues Addressed: {n}      (fixes verified)

Production Health: {EXCELLENT|GOOD|NEEDS ATTENTION}

Things that worry SequrAI:
- {worry 1}
- {worry 2}

Recommendations:
- {single primary CTA, often Safe Fix}
```

**Delivery:** Email + PDF/HTML in dashboard.  
**Data source:** Production Memory + latest verdict.

**Complete experience design (weekly + monthly, stats, MCP, roadmap):** [../protection-reports/README.md](../protection-reports/README.md).

---

## Security alerts

| Trigger | Channel | Idempotent |
|---------|---------|------------|
| New critical finding | In-app + email | Yes |
| Confidence drop ≥ threshold | In-app + email | Yes |
| Dependency critical advisory (new) | In-app | Yes |
| Unsafe deploy check (NO-GO) | In-app | Optional email |
| Attack surface increased | Weekly digest | Yes |
| Continuous protection paused | In-app | Once |

Copy: protection language, not CVE dumps.

**Expanded design (types, severity, workflows, MCP, noise budget):** [../security-alerts/README.md](../security-alerts/README.md).

---

## Production health (V1)

Composite score **0–100** and label **EXCELLENT / GOOD / NEEDS ATTENTION / AT RISK**:

| Factor | Weight (V1) |
|--------|----------------|
| Latest security confidence | 35% |
| Latest production confidence | 35% |
| Recency of review (&lt; 7 days) | 15% |
| Open critical/high count | 15% |

Exposed in MCP (`production_history` + narrative) and dashboard.

---

## Dependency monitoring V1

- **Scope:** npm/pnpm/yarn lockfiles + package.json (expand later).
- **Method:** Diff lockfile vs last check; query advisory API (e.g. OSV) for **critical** only in V1.
- **Not in V1:** Full SCA platform, license policy engine.

---

## Attack surface evolution V1

Compare static model snapshots:

- New public routes / API handlers detected.
- Auth middleware changes.
- New webhooks or OAuth callbacks.
- Secrets pattern in diff (blocker, no secret values stored).

Report in weekly/monthly; alert on level change.

---

## Behaviour detection V1 (rules only)

| Rule ID | Condition | Action |
|---------|-----------|--------|
| BD-01 | Confidence drop ≥ 10 in 24h | Alert |
| BD-02 | 3+ new medium findings in 7 days | Weekly highlight |
| BD-03 | No review in 14 days while CP ON | Nudge alert |
| BD-04 | Repeated NO-GO deploy checks | Memory + “needs attention” |

No ML. Rules documented and testable.

---

## User controls (web)

- Continuous Protection ON/OFF (default ON).
- Alert email ON/OFF.
- Monthly report ON (default).
- “Pause protection” requires confirmation copy explaining risk.

---

## MCP integration

- Scheduled jobs update Memory; MCP reads latest on user question.
- No separate MCP tool for “run daily check”—user asks “am I protected?”

---

## Non-goals (V1)

- Network traffic analysis.
- Log streaming from production.
- Cloud account scanning.
- WAF rule management.

Architecture hooks in doc 09 only.

---

## Success criteria

- ≥ 80% of active projects have CP ON.
- &lt; 5% alert noise rate (alerts / daily checks).
- Monthly report open rate ≥ 40% in beta.
