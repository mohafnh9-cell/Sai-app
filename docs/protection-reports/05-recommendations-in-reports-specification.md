# Recommendations in Reports Specification

**Purpose:** Every weekly and monthly report ends with **one** clear next action — tied to Recommendations History.

Source: [../production-memory/06-recommendations-history-specification.md](../production-memory/06-recommendations-history-specification.md).

---

## Selection logic

Pick **one** primary recommendation:

| Priority | Source |
|----------|--------|
| 1 | Open **critical** recommendation |
| 2 | Open **high** recommendation |
| 3 | Top worry from verdict without open rec → generate implicit “Review again / Safe Fix” from worry |
| 4 | If PROTECTED and nothing open | *Keep continuous protection on — optional polish: {low med item}* |

Never list 5 equal bullets under “Recommendations.”

---

## Report sections

### Weekly — “What to do next”

- One sentence + button **Apply Safe Fix** or **Copy fix for Cursor**  
- If status REQUIRES ATTENTION: verb **before** next deploy  

### Monthly — “What to do next”

- Same + optional “first week of {next month}” framing  
- Link to open recommendations count: *“{n} items still on my list — this is the one I'd do first.”*

---

## What improved? — recommendations angle

Monthly **What improved** includes verified recommendations:

```
• Mar 8 — Fixed unsafe auth flow (verified)
• Mar 22 — Rate limiting applied (verified)
```

Weekly: only fixes verified **this week**.

---

## Closed vs open

| State | Monthly mention |
|-------|-----------------|
| verified | What improved |
| open | What to do next (if highest priority) |
| dismissed | Footnote only if still worrying finding exists |

---

## Safe Fix parity

Report CTA deep links to same `recommendationId` as Protection Center and MCP `safe_fix`.

---

## Copy examples

**Open critical:**

> **Recommendation:** Apply Safe Fix for authentication on `/api/admin` — this is what I'd fix before you scale traffic.

**All verified:**

> **Recommendation:** No urgent fixes — run a quick review after your next major feature.

---

## Acceptance criteria

- Primary recommendation matches Protection Center hero CTA.  
- Monthly counts “Critical issues addressed” = verified critical recs only.  
- No report ships with empty “What to do next” section.
