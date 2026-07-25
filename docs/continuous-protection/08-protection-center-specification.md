# Protection Center Specification

**Purpose:** The **future dashboard** where trust is visible in **five seconds**. Not a scanner console.

**Note:** UX sprint may ship interim “Home” layout first; this spec is the **target Protection Center** for Hybrid V1 continuous protection.

---

## Entry points

- Project drill-down from portfolio
- Alert deep link
- Weekly summary “View full protection”
- Onboarding finale → “See your protection”

---

## Page hierarchy (single column, mobile-first)

```
┌─────────────────────────────────────────────┐
│ YOUR APPLICATION IS:                        │
│ {PROTECTED | SAFE WITH CAUTION | …}         │  ← doc 04 hero
├─────────────────────────────────────────────┤
│ Production confidence    Security confidence│
│ {n}%                     {n}%               │
│ [30-day sparkline]                          │  ← doc 05
├─────────────────────────────────────────────┤
│ Things that worry me:                       │
│ • {worry}                                   │  ← max 3
├─────────────────────────────────────────────┤
│ Recommendation:                             │
│ [ Apply Safe Fix ]  [ Copy fix for Cursor ] │  ← primary + secondary
├─────────────────────────────────────────────┤
│ This week (collapsible)                     │  ← doc 03 card
├─────────────────────────────────────────────┤
│ Protection settings                         │
│ Continuous Protection [ON]                  │
│ Email alerts [ ]                            │
└─────────────────────────────────────────────┘
```

**Below the fold (not hero):**

- Timeline lite (last 10 protection events)
- Link to monthly report archive
- GitHub + Cursor connection status

---

## Copy system

| Element | Rule |
|---------|------|
| Hero status | ALL CAPS label only for status word — sentence case for rest |
| Confidence | Always paired: Production + Security — never lone “score” |
| Worries | “Things that worry **me**” — SequrAI voice |
| Recommendation | One verb-led line + single primary button |
| Last checked | Relative time; if stale, honest |

### Example (PROTECTED with mild worry)

```
YOUR APPLICATION IS:
PROTECTED

Production confidence: 97%
Security confidence: 98%

Things that worry me:
• Missing rate limiting on public API routes.

Recommendation:
Apply Safe Fix before your next deploy.
```

---

## Metrics on page (allowed)

| Metric | Display |
|--------|---------|
| Production confidence % | Yes — secondary to status |
| Security confidence % | Yes |
| Production Health label | Subhead under sparkline |
| Protection checks 7/7 | Weekly card only |
| CVE count | **No** |
| Domain breakdown tables | **Collapsed** “Details for engineers” optional later |

---

## Portfolio → Protection Center

Each row:

- App name
- **Protection status badge** (four states)
- One worry OR “Protected — nothing urgent”
- No raw scores in list (UX sprint alignment)

---

## Empty / edge states

| State | Hero | CTA |
|-------|------|-----|
| First review running | NOT PROTECTED → “Checking your app…” | — |
| CP paused | NOT PROTECTED | Turn protection on |
| GitHub missing | NOT PROTECTED | Connect GitHub |
| REQUIRES ATTENTION | As doc 04 | Safe Fix |

---

## Relationship to MCP

Protection Center is **visual parity** with MCP answers — same status, same worries, same recommendation text source (single content model when implemented).

Founder workflow:

- **Quick check in Cursor:** “Am I protected?”
- **Share with co-founder:** Protection Center URL
- **Act:** Safe Fix button

---

## What to hide vs scanner legacy

Remove or hide from nav (see ux-sprint doc 07):

- “Security” tab as primary findings table
- “Timeline” as empty jargon nav
- “AI Fixes” as separate product

Fold into Protection Center as **timeline lite** only.

---

## Acceptance criteria

- Time-to-understand status **&lt; 5 seconds** in user tests.
- Hero status matches MCP `can_i_deploy` composite for same snapshot.
- One primary CTA visible without scroll on mobile.
- Continuous Protection toggle default **ON** with confirm-on-pause copy.
