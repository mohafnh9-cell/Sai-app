# Dashboard Redesign Proposal

**Scope:** Information architecture and visual hierarchy—**no new widgets** for continuous protection, memory, alerts, or reports.

**One question:** “Can I ship?” or “Which app needs attention?”

---

## Problems today

- **ProductionControlCenter** + **PortfolioVerdictCard** + empty states + **FirstVerdictDashboardModal** compete for attention.
- Sidebar: Integrations + Settings before user internalizes deploy answer.
- Language: “Can you deploy?” good; portfolio rows expose scores without story.
- First-time users land here **after onboarding** without project context.

---

## Proposed layout (dashboard v2)

### First visit (`?firstVerdict=1` or within 24h of signup)

**Full-width hero only—no portfolio grid.**

```
┌──────────────────────────────────────────────────┐
│  Your deploy answer                              │
│  [ Largest ProductionControlCenter / verdict ]   │
│  Primary: Open {project}                         │
│  Secondary: Connect Cursor (if not done)         │
└──────────────────────────────────────────────────┘
```

**Remove modal** `FirstVerdictDashboardModal`—inline hero sufficient.

---

### Returning user (1–3 projects)

```
┌─ Needs attention (0–1 projects) ────────────────┐
│  Only projects with NO-GO or stale &gt; 7 days    │
└──────────────────────────────────────────────────┘

┌─ All apps ──────────────────────────────────────┐
│  Simplified PortfolioVerdictCard rows:           │
│  • App name                                      │
│  • READY / NOT YET / ALMOST (badge)              │
│  • One line worry OR “Ready to ship”             │
│  • Chevron → project                             │
└──────────────────────────────────────────────────┘
```

**Hide:** Raw numeric scores in list view—show on project drill-down only.

---

### Returning user (4+ projects)

- Add search filter on “All apps”.
- Still no charts (no memory UI this sprint).

---

## Sidebar (simplified)

| Keep | Label change |
|------|----------------|
| Dashboard | **Home** or keep Dashboard |
| Projects | **Your apps** |
| Integrations | **GitHub** |
| Settings | **Settings** |

**Hide from nav (routes remain):** Timeline, Security, AI Fixes—see doc 07.

---

## Empty states

| State | Copy | CTA |
|-------|------|-----|
| No projects | “Connect an app to get your deploy answer.” | **Connect GitHub** → onboarding resume |
| No verdict yet | “Finish your first check.” | **Continue setup** → `/onboarding` |
| All ready | “All apps ready to ship.” | Connect Cursor nudge |

---

## Project page (companion to dashboard)

Dashboard sends users to project for **fix loop**; dashboard stays summary-only.

**Do not duplicate** Safe Fix hero on dashboard—link “Fix in project →”.

---

## Visual system (Stripe/Linear-like)

- **One accent color** for primary CTA only.
- **Status colors:** Green (ready), amber (almost), neutral red only for “not yet”—avoid alarm red.
- **Typography:** Large deploy answer (YES/NO); body 15–16px; reduce uppercase tracking except eyebrow.
- **Whitespace:** Max content width 640px on onboarding; 960px dashboard.

---

## Copy alignment

| Element | Proposed |
|---------|----------|
| Hero question | “Can you deploy?” → **“Ready to ship?”** |
| YES | **Yes — ready to ship** |
| NO | **Not yet** |
| Portfolio section | **Your apps** |

Use i18n keys in `dashboard.json` when implementing.

---

## `ProductionVerdictHero` hardcoded strings

Move “Can I deploy?”, “YES.”, “NO.”, “ALMOST.” to i18n—design requirement for ES parity.

---

## Acceptance criteria

- [ ] First-time dashboard shows **one** hero block, no modal.
- [ ] Portfolio row readable in 5 seconds (“ready or not + one worry”).
- [ ] No sidebar link to unfinished product areas.
- [ ] Dashboard does not surface technical report links above fold.

---

## Out of scope

- Protection dashboard, monthly reports, alert inbox, confidence history charts.
