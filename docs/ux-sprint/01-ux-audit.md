# Complete UX Audit

**Date:** 2026-07-24  
**Scope:** Paths that affect first-time founder through first deploy confidence.  
**Method:** Code + copy review; aligned with Product Bible positioning (peace of mind, not cyber).

---

## Executive summary

SequrAI has strong **engine depth** (verdict, Safe Fix, MCP) but the **first-run story is fragmented**: too many product words, an extra screen after the verdict, Safe Fix and MCP absent from the golden path, and Settings-buried MCP setup. Users can get a verdict quickly but often **do not know what to do next**—especially when blockers exist.

**Severity:** Onboarding P0, Safe Fix prominence P0, MCP discovery P1, dashboard clarity P1, jargon P1.

---

## Current golden path (as built)

```
Sign up → Workspace → Connect GitHub → Pick repo → Production Review (auto) 
  → Verdict reveal (+900ms animation) → [Click "View Production Verdict"] 
  → "Ready to deploy" interstitial → Open project OR Dashboard
```

**Missing from path:** Safe Fix (copy/paste loop), Review again, explicit Ready to Ship moment, MCP connect.

**Completion trigger:** Any org-level `production_verdicts` row → user skipped to `/dashboard` on return—may never see project Safe Fix hero.

---

## Screen-by-screen audit

### Auth (`/signup`, `/login`)

| | |
|---|---|
| **Works** | Redirect to `/onboarding` after signup |
| **Friction** | “Workspace” before value prop; no preview of outcome (“You’ll know if you can ship”) |
| **Jargon** | None severe |
| **Next action** | Clear (create account) |

### Welcome / workspace (`onboarding?step=welcome`)

| | |
|---|---|
| **Works** | Single field, fast |
| **Friction** | Explains “workspace” instead of “your apps” |
| **Copy** | “Production Reviews” in body—technical |
| **Next action** | OK |

### GitHub (`step=github`)

| | |
|---|---|
| **Works** | Scopes explanation exists |
| **Friction** | Title fine; body still “review before deployment” not “protect / ready to ship” |
| **Next action** | Clear CTA |

### Repository (`step=repository`)

| | |
|---|---|
| **Works** | Search, single select, auto-advance to review |
| **Friction** | “Review this repository” vs later “Production Review”—same action, three names |
| **Next action** | Clear |

### Production Review (`step=review`)

| | |
|---|---|
| **Works** | Auto-starts scan; staged progress messages (founder-friendly stages) |
| **Friction** | 8m stall messaging; failure copy OK |
| **Risk** | User waits without knowing *when* verdict appears (no “~2 min” expectation on screen) |
| **Next action** | Wait (passive)—needs reassurance line |

### Verdict reveal (`step=verdict`)

| | |
|---|---|
| **Works** | `ProductionVerdictHero` product variant; next action block for top priority |
| **Friction** | **900ms fake “building” after review already built verdict**—adds time, feels redundant |
| **Friction** | Primary CTA **“View Production Verdict”** when user is *already viewing* verdict—misleading |
| **Friction** | Safe Fix not shown here—only text “recommended action” |
| **Next action** | Confusing CTA label |

### Dashboard entry (`step=dashboard`)

| | |
|---|---|
| **Works** | Two exits: project vs dashboard |
| **Friction** | **Entire step is redundant** if verdict step already showed hero + next action |
| **Copy** | “Ready to deploy” progress tick—good emotionally, bad as extra click |
| **Next action** | Split between two buttons—should be one primary |

### Project overview (`/projects/:id`)

| | |
|---|---|
| **Works** | `ProjectVerdictSummary` + `ProjectSafeFixHero` 3-step flow |
| **Friction** | Safe Fix hero **hidden when ready_to_ship**—only Analyze button |
| **Friction** | `?onboarded=1` query **ignored**—no guided banner |
| **Friction** | Sub-nav (Overview, History, Technical Details) competes with single next step |
| **Next action** | Competes with nav + collapsed sections |

### Dashboard (`/dashboard`)

| | |
|---|---|
| **Works** | `ProductionControlCenter` “Can you deploy?” |
| **Friction** | Portfolio cards + empty states + first-verdict modal—multiple heroes |
| **Jargon** | “Production Control Center” internal naming |
| **Next action** | OK for returning users; noisy for day 0 |

### Settings → MCP

| | |
|---|---|
| **Works** | Key generation + JSON snippet |
| **Friction** | **Not in onboarding**; no link from verdict/project |
| **Friction** | Placeholder paths differ (`workspaceFolder` vs `/path/to/...`) in orphan vs settings |
| **Friction** | No “paste this, then ask Can I deploy?” |
| **Next action** | Unclear for non-developers |

### Integrations (parallel path)

| | |
|---|---|
| **Works** | Multi-repo, webhooks |
| **Friction** | Duplicates onboarding repo pick; English hardcoded chunks |
| **Next action** | Overwhelming for first-run—should be post-onboarding |

---

## Cognitive load inventory (terms users see)

| Term | Count / locations | Founder-friendly alternative |
|------|-------------------|----------------------------|
| Production Verdict | Onboarding, nav, hero | **Deploy answer** or keep one hero label only |
| Production Review | Onboarding progress | **Checking your app** |
| Safe Fix | Project, verdict, MCP | **Fix in Cursor** (action) |
| Workspace | Auth, settings | **Your account** / drop after create |
| MCP | Settings only | **Connect Cursor** |
| Technical Details | Sub-nav | Hide until week 2 |
| Production Journey | Nav label | **History** |
| Integrations | Sidebar | **GitHub** (single word) |

---

## Friction scorecard (1 = low, 5 = high)

| Step | Friction | Why |
|------|----------|-----|
| Signup | 2 | Standard |
| Workspace | 2 | Extra concept |
| GitHub | 2 | OAuth unavoidable |
| Repo pick | 2 | OK |
| Review wait | 3 | Uncertain duration |
| Verdict reveal | 4 | Extra animation + wrong CTA |
| Dashboard entry step | 5 | Redundant screen |
| Find Safe Fix | 4 | Not on onboarding path |
| MCP setup | 5 | Hidden in Settings |

---

## Competitive feel check

| Desired | Current gap |
|---------|-------------|
| One hero answer | Verdict hero good; diluted by steps after |
| One primary button | Multiple CTAs and nav |
| Calm empty space | Dense cards, sub-nav, intelligence collapsed |
| Plain language | Mixed engineer + product terms |
| Magic moment | Review stages good; post-verdict steps kill momentum |

---

## Moderated test predictions (without changes)

| Question | Likely result today |
|----------|---------------------|
| “Are you ready to ship?” after onboarding | ~60% can answer from hero |
| “What should you do next?” if NO-GO | ~40% find Safe Fix without hint |
| “How connect Cursor?” | ~20% find without help |
| “What is Production Review?” | Confusion common |

---

## Priority fixes (UX sprint only)

1. Collapse verdict + dashboard entry into **one finale screen** with verdict hero + single CTA.
2. Embed **Safe Fix** on verdict screen when blockers exist (not only on project page).
3. Add **finale step: Connect Cursor** (60s) after Ready to Ship or parallel optional skip.
4. Rename progress labels to **plain English** (see doc 02).
5. Remove fake verdict building animation post-scan.
6. Project page: **onboarded banner** with one next step.
7. Unify Safe Fix button copy globally.

---

## Out of scope (this sprint)

- Continuous protection toggles, alerts, reports, memory UI, auto PR flows.

See implementation specs in docs 02–07.
