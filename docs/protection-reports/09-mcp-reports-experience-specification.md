# MCP Reports Experience Specification

**Constraint:** **Five tools only.** Reports are **not** a separate MCP tool. Users ask in natural language; hosts route to **`production_history`**, **`what_changed`**, **`can_i_deploy`**.

---

## Design principle

> *The monthly PDF is the artifact; MCP is the conversation about it.*

MCP synthesizes the **same narrative builders** as weekly/monthly jobs — never stale generic advice.

---

## Intent map

| User phrase | Tool | Report equivalent |
|-------------|------|-------------------|
| How was my month? | `production_history` `rangeDays=30` | Monthly summary |
| How was my week? | `production_history` `rangeDays=7` | Weekly card |
| Am I becoming more protected? | `production_history` + `can_i_deploy` | Opening verdict |
| What improved? | `production_history` | What improved section |
| What worries you? | `can_i_deploy` | Worries block |
| What should I do next? | `can_i_deploy` → `safe_fix` | Recommendation |
| Send me my report | Explain web archive — no email tool | — |
| Summarize last month like the report | `production_history` | Full monthly narrative in text |

---

## `production_history` report mode (design)

When query matches month/week summary intents, formatter returns **report sections in order**:

1. Protection summary (four questions 1+3+4 teaser)  
2. Confidence trends (arrows)  
3. What improved (bullets)  
4. Statistics (compact)  
5. What worries / what next  

**Max length:** ~400 words unless user asks for detail.

---

## Parity

| Field | MCP vs monthly email |
|-------|----------------------|
| Status | Identical |
| Confidence start/end | Same snapshot ids |
| Top worry | Same string |
| Primary recommendation | Same recommendationId |

Automated tests compare formatter output to report template golden files.

---

## Conversation examples

**Founder:** Am I becoming more protected?

**SequrAI (`production_history` + `can_i_deploy`):**

```
Yes — compared to last month you're more protected.

Status: PROTECTED (was SAFE WITH CAUTION on Mar 1)
Production confidence: 78% → 94%
We verified 2 fixes and completed 29/30 daily checks.

What still worries me:
• Rate limiting on public APIs

What to do next:
Apply Safe Fix for rate limiting this week.
```

**Founder:** What improved since last month?

**SequrAI (`production_history`):**

```
• Auth flow fix verified Mar 8
• Attack surface back to LOW after removing public admin route
• Zero material alerts in the last two weeks
```

---

## What MCP does not do

- Attach PDF binary  
- Regenerate monthly job on demand (unless `review_now` for fresh data)  
- Claim report metrics without Memory  
- New tool `get_monthly_report`  

---

## After monthly email

Optional host hint (client instructions):

> *If user mentions monthly email, use production_history rangeDays=30.*

---

## Acceptance criteria

- Intent eval rows for “how was my month”, “what improved”, “am I more protected”.  
- MCP does not contradict archived monthly PDF for same `{projectId}:{yyyy-mm}`.
