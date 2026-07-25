# Monthly Alerts Specification

**Purpose:** Clarify what **monthly** communication is — **Protection Report / proof**, not panic paging.

Monthly is **not** an alert storm. It is **peace-of-mind documentation** for founders and stakeholders.

---

## Monthly deliverable

**Monthly Protection Report** (Product Bible doc 06):

- Email + dashboard archive  
- PDF/HTML optional  
- Data from Production Memory — zero manual edit  

---

## Alert relationship

| Concept | Monthly behavior |
|---------|------------------|
| Urgent/Important fired in month | **Summarized**, not re-sent |
| Unresolved alerts at month end | Called out in “Still open” section |
| Silent weeks | Celebrated as “continuous protection active” |
| noise_rate | Reported internally — **not** in founder PDF |

### Report section: “Alerts that mattered”

```
This month SequrAI notified you {n} times about important changes.
Each time: what changed and what to do next.

Highlights:
• {date} — {one line plain language}
• …

Unresolved as of {month end}:
• {worry + recommendation} OR "None"
```

**No** CVE appendix.

---

## Should I worry? (monthly lens)

Closing narrative paragraph:

| End state | Copy |
|-----------|------|
| PROTECTED, quiet month | *You're entering next month protected — keep continuous protection on.* |
| Improved confidence | *Trust increased — fixes worked.* |
| REQUIRES ATTENTION | *I'd resolve {x} before you scale traffic.* |

---

## What changed? (30-day)

Aggregate from Memory:

- Confidence start → end  
- Attack surface label start → end  
- Fixes verified count  
- Deploy checks / blocks count  
- Dependency critical events count  

Not a day-by-day alert log.

---

## What should I do next?

Single **primary recommendation** for next month — same as weekly but broader:

> *Apply Safe Fix on {top open item} in your first week of {next month}.*

---

## vs Weekly

| | Weekly | Monthly |
|---|--------|---------|
| Tone | Coach check-in | Record / proof |
| Length | &lt; 2 min | 3–5 min |
| Audience | Founder daily | Founder + investor optional forward |
| Interrupt | Low | None — expected calendar |

---

## Email

- **Subject:** `SequrAI Monthly — {Project} — {Month YYYY}`  
- **Not** “Security Alert”  
- Send **once** per project per month (dedupe `{projectId}:{yyyy-mm}`)

---

## In-app

- Archive list under Protection Center → Reports  
- Does not use urgent badge  

---

## Acceptance criteria

- Monthly send does not increment daily noise_rate.  
- Report lists ≤ 10 alert highlights; rest “+ N more in app.”  
- Unresolved section matches open recommendations table.
