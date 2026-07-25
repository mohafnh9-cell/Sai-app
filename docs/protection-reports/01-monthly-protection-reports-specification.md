# Monthly Protection Reports Specification

**Purpose:** The **monthly proof artifact** — branded record that SequrAI continuously protected the project for 30 days.

**Not:** A vulnerability export, compliance pack, or alert replay.

---

## Deliverables (Hybrid V1)

| Artifact | Format | Channel |
|----------|--------|---------|
| Monthly Protection Report | HTML + optional PDF | Email |
| Archive copy | Same HTML/PDF | Protection Center → Reports |
| Memory event | `monthly_report_generated` | Internal |

**Schedule:** Once per project per calendar month, **day 1** of following month (or last day of month — pick one globally; recommend **1st at 09:00 user-local**).

**Dedupe:** `{projectId}:{yyyy-mm}`.

---

## Required narrative arc

Reports must answer the four questions in order:

1. **Am I becoming more protected?** — Opening verdict paragraph  
2. **What improved?** — Confidence + fixes + evolution  
3. **What worries SequrAI?** — Worries block  
4. **What should I do next?** — One recommendation  

---

## Full template (founder-facing)

```
SEQURAI MONTHLY PROTECTION REPORT
{Project name} · {Month YYYY}

────────────────────────────────────────
YOUR PROTECTION THIS MONTH
────────────────────────────────────────

Your application is: {PROTECTED | SAFE WITH CAUTION | REQUIRES ATTENTION | NOT PROTECTED}

Am I becoming more protected?
{2–3 sentences — opinion. Compare month-start vs month-end status and confidence direction.}

────────────────────────────────────────
CONFIDENCE
────────────────────────────────────────

Production confidence:  {start}% → {end}%  ({↑|↓|→})
Security confidence:    {start}% → {end}%
Production health:      {label at month end}

Attack surface:         {level at start} → {level at end}

[Optional sparkline image or ASCII summary in PDF]

────────────────────────────────────────
WHAT IMPROVED
────────────────────────────────────────

• {fix verified plain title — date}
• {positive evolution bullet}
• {optional: "Quiet weeks with daily checks completed: n"}

If nothing improved:
• {Honest line: "This month was about holding the line — no regressions."}

────────────────────────────────────────
PROTECTION STATISTICS
────────────────────────────────────────

Daily protection checks completed:     {n} / {days in month}
Full protection reviews:               {n}
Times SequrAI reached out (important): {n}
Unsafe deployments prevented:          {n}
Critical issues addressed:             {n}

────────────────────────────────────────
WHAT WORRIES SEQURAI
────────────────────────────────────────

• {worry 1}
• {worry 2}
• {worry 3 max}

If none material:
• Nothing urgent — {one mild watch item OR "keep building"}.

────────────────────────────────────────
WHAT TO DO NEXT
────────────────────────────────────────

Recommendation:
{Single primary action — Apply Safe Fix for X | Review again | Turn protection back on}

[ Apply Safe Fix ]  [ Open Protection Center ]

────────────────────────────────────────
Alerts that mattered (summary)
────────────────────────────────────────

{See security-alerts monthly section — max 10 lines}

SequrAI — Your Production & Protection Engineer.
Continuous protection was {ON | OFF} this month.
```

---

## Data binding (Production Memory)

| Report field | Memory source |
|--------------|---------------|
| Status start/end | First/last `protection_status` in month |
| Production confidence start/end | First/last daily snapshot in month |
| Security confidence start/end | Same |
| Health label | Latest snapshot in month |
| Attack surface | First/last `attack_surface_snapshot` |
| Daily checks | Count `continuous_check_completed` |
| Full reviews | Count `protection_review_completed` |
| Important outreach | Count `alert_sent` urgent+important |
| Unsafe deployments prevented | Count `deploy_blocked` |
| Critical issues addressed | Count `fix_verified` severity critical |
| Worries | Latest `verdict_created` worriesTop3 |
| Recommendation | Top open `protection_recommendations` |
| What improved | Derived from `fix_verified` + confidence ↑ events |

**Zero manual editing** in operations.

---

## Brand & tone

- First person SequrAI voice: *“I watched your app every day…”*  
- No CVE IDs in body  
- No “security score” as hero — status + narrative first  
- Footer: continuous protection ON/OFF honesty  

---

## Email

| Field | Value |
|-------|-------|
| Subject | `SequrAI Monthly — {Project} — {Month YYYY}` |
| Preheader | *Proof your app was protected in {Month}* |
| From | SequrAI Reports |

One email per project per month. Default **ON** for paid (bible); opt-out in Settings.

---

## PDF (optional V1)

- Generated from same HTML template  
- Stored in archive with signed URL (12mo retention)  
- Filename: `SequrAI-{ProjectSlug}-{YYYY-MM}.pdf`

---

## Edge cases

| Case | Report behavior |
|------|-----------------|
| Project created mid-month | Pro-rate stats; narrative says “partial month” |
| CP paused whole month | NOT PROTECTED narrative; stats show gap |
| No snapshots | Skip send; queue catch-up report after first full month |
| Multiple repos | One report **per project** — no org mash-up in V1 |

---

## Acceptance criteria

- Report generates from Memory fixtures with golden snapshot tests.  
- All four questions answered in first screen (email) or first PDF page.  
- Open rate target ≥ 40% beta (bible).  
- Forward-friendly: no embarrassing scanner jargon.
