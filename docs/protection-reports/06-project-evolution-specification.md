# Project Evolution Specification

**Purpose:** Tell the **story of the app over the reporting period** — how the project changed under SequrAI's watch.

**Not:** Git commit log. **Is:** Protection-relevant evolution.

---

## Evolution dimensions (V1)

| Dimension | Weekly | Monthly |
|-----------|--------|---------|
| Protection status trajectory | start → end | same + narrative |
| Attack surface | stable / up / down | level start → end |
| Dependencies | critical advisories, package churn summary | count + worst event |
| Architecture signals | new routes, auth changes (plain) | top 3 evolution bullets |
| Fixes journey | verified this week | timeline of verified fixes |
| Deploy posture | NO-GO/GO checks count | unsafe prevented stat |

---

## “What improved?” content source

Aggregate from Memory:

| Event type | Evolution story |
|------------|-----------------|
| `fix_verified` | Positive milestone |
| `attack_surface_snapshot` delta down | Reduced exposure |
| `protection_status_updated` to better state | Protection win |
| `confidence_snapshot` trend up | Trust win (with cause) |
| Silent daily week | Stability win |

---

## Monthly evolution paragraph (template)

> *In {Month}, your app {gained X|stabilized|needs work}. The biggest shift was {plain language}. We caught {n} material changes before they became incidents. {If fixes: After you fixed {title}, confidence recovered.}*

---

## Weekly evolution (shorter)

> *This week was {quiet|active}. {One sentence on what changed materially.}*

---

## Timeline integration

Monthly report optional **“Month in moments”** — max 5 dated lines from [Protection Timeline](../production-memory/08-protection-timeline-specification.md):

```
Mar 3  — First daily check completed
Mar 9  — Material change: new API route (resolved Mar 11)
Mar 18 — Deploy check: ready
```

Not more than 5 lines in email; full timeline in app.

---

## Am I becoming more protected?

Evolution section **feeds** the opening verdict:

| Pattern | Answer |
|---------|--------|
| Status same or better + confidence ↑ | More protected |
| Status same + flat confidence + no material issues | Protected steady |
| Status worse or confidence ↓ | Not more protected — honest |
| CP off | Cannot claim improvement |

---

## What worries SequrAI?

Evolution explains **how we got to current worries**:

> *The worry about rate limiting started when /api/export shipped on Mar 9.*

---

## Acceptance criteria

- Evolution bullets sourced from Memory event types only — no hallucinated commits.  
- Partial month projects label evolution as partial.  
- No raw SHAs in founder PDF (short hash OK in appendix for engineers — backlog).
