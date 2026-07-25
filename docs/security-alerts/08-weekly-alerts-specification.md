# Weekly Alerts Specification

**Purpose:** **Digest channel** — patterns and summaries that should **not** interrupt daily, plus the **Weekly Protection Review** as positive proof.

Weekly is **not** “more alerts” — it **absorbs noise** and answers *“Should I worry this week?”* at a calmer cadence.

---

## Two weekly deliverables

| Deliverable | Type | Interrupt? |
|-------------|------|------------|
| **Weekly Protection Summary** | Product email + in-app card | Low — expected rhythm |
| **Digest highlights (AT-13–15)** | Section inside summary | No separate ping |

---

## Weekly Protection Summary

Content from [continuous-protection/03](../continuous-protection/03-weekly-protection-review-specification.md) plus alert rollup:

```
YOUR APPLICATION IS:
{status}

This week at a glance
• Checks completed: 7/7
• Alerts that mattered: {n} (or "None — quiet week")

Should you worry?
{One sentence — opinion}

What changed:
• {max 5 bullets}

Patterns I noticed (digest):
• {AT-13|14|15 plain language or "None"}

What to do next:
• {single recommendation}
```

---

## Digest-only alert types (weekly)

| alertKind | Weekly presentation |
|-----------|---------------------|
| AT-13 | *More small issues than usual — let's tidy before they stack.* |
| AT-14 | *You checked deploy several times — same blocker.* |
| AT-15 | *Heavy change day — worth a fresh review.* |

**No** instant inbox notification for these in default config.

---

## Weekly vs daily boundary

| Signal | Daily | Weekly |
|--------|-------|--------|
| Critical finding | Immediate Urgent | Also mentioned in summary |
| 3 mediums in 7d | — | Digest section |
| Confidence −5 over 7d (not cliff) | — | Narrative in summary only |
| Attack surface stable | Silent | “Attack surface: stable” |

---

## Email schedule

- **Day:** Monday 08:00 user-local (configurable architecture)  
- **Subject:** `Your week with SequrAI — {Project}`  
- **Not** labeled “ALERT” — labeled **summary**  

Unsubscribe: separate from urgent email toggle optional — V1: one “SequrAI email” toggle covers both urgent + weekly.

---

## In-app

- Card on Protection Center until dismissed  
- Does **not** increment urgent badge unless week included unresolved Urgent still unread  

---

## Should I worry? (weekly framing)

| Week profile | Opener |
|--------------|--------|
| Quiet, PROTECTED | *No — nothing material this week.* |
| Digest only | *Not urgently — but one pattern to address.* |
| Had Urgent mid-week | *You already fixed the urgent item — here's what's left.* |
| REQUIRES ATTENTION open | *Yes — still needs attention going into next week.* |

---

## Noise contribution

Weekly emails **do not** count toward daily `noise_rate` numerator.

Track separately: **weekly open rate** ≥ 40% (bible).

---

## Acceptance criteria

- Digest rules never create Urgent severity.  
- Weekly summary sent even on quiet week (positive proof).  
- AT-13–15 appear max once per week combined section.
