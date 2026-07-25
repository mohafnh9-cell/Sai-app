# Weekly Protection Reports Specification

**Purpose:** **Weekly coach check-in** — lighter than monthly, faster than inbox alerts. Proof that SequrAI watched **this week**.

**Relationship:** Weekly is a **Protection Report** at 7-day granularity; monthly **rolls up** four weekly summaries + full-month stats.

Expanded job detail: [../continuous-protection/03-weekly-protection-review-specification.md](../continuous-protection/03-weekly-protection-review-specification.md).

---

## Deliverables

| Artifact | Channel |
|----------|---------|
| Weekly Protection Summary | In-app card (Protection Center) |
| Optional email | Same content, shorter |
| Memory | `weekly_summary_generated` |

**Schedule:** Monday 08:00 user-local (recommended).  
**Read time:** &lt; 2 minutes.

---

## Template

```
YOUR WEEK WITH SEQURAI
{Project} · Week of {Mon date}

────────────────────────────────────────
PROTECTION SUMMARY
────────────────────────────────────────

Your application is: {status}

Am I becoming more protected?
{One sentence — compare to last week status/confidence}

────────────────────────────────────────
CONFIDENCE THIS WEEK
────────────────────────────────────────

Production: {start}% → {end}%  ({↑|↓|→})
Security:   {start}% → {end}%

────────────────────────────────────────
WHAT IMPROVED
────────────────────────────────────────

• {fix verified OR "No regressions — quiet week"}
• {optional attack surface reduced}

────────────────────────────────────────
WHAT CHANGED
────────────────────────────────────────

• {max 5 plain bullets from Memory diff}

────────────────────────────────────────
WHAT WORRIES SEQURAI
────────────────────────────────────────

• {max 3}

────────────────────────────────────────
WHAT TO DO NEXT
────────────────────────────────────────

{Single recommendation + CTA}

Checks completed: {n}/7
```

---

## Four questions (weekly lens)

| Question | Section |
|----------|---------|
| Am I becoming more protected? | Protection summary opener |
| What improved? | What improved |
| What worries SequrAI? | Worries |
| What should I do next? | What to do next |

---

## Email (optional)

- Subject: `Your week with SequrAI — {Project}`  
- Default OFF in beta, ON optional with monthly bundle  
- Not labeled “alert”  

---

## vs Monthly

| | Weekly | Monthly |
|---|--------|---------|
| Stats depth | 7-day checks only | Full month + prevented counters |
| Evolution | Week delta | Month arc + timeline highlights |
| Investor use | Rare | Primary forward artifact |
| PDF | No | Yes |

---

## MCP

User: *“How was my week?”* → `production_history` with `rangeDays=7` using same narrative builder as weekly card (doc 09).

---

## Acceptance criteria

- Sent even on quiet weeks (proves watching).  
- Single recommendation only.  
- Weekly email does not duplicate monthly send in same calendar week as month boundary (dedupe rules in doc 10).
