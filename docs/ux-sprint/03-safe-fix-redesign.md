# Safe Fix Redesign

**Goal:** Safe Fix is **impossible to miss** on the path from first NO-GO to Ready to Ship.

**Constraint:** No new fix engine features—UI, copy, placement, naming only.

---

## Problems today

1. Safe Fix lives primarily on **project page**, not onboarding finale.
2. When `ready_to_ship`, **ProjectSafeFixHero** disappears—only analyze remains (OK) but users never learned Safe Fix on happy path (acceptable).
3. **Three names:** “Copy Safe Fix”, “Copy Safe Fix Prompt”, MCP “SAFE FIX”.
4. **FastestPathForward** and **TechnicalFindingsSection** offer secondary Safe Fix buttons—competing hierarchy.
5. Onboarding orphan **OnboardingSafeFixStep**—broken i18n, not in flow.

---

## Design principles

1. **One primary fix action** per screen: **“Copy fix for Cursor”**
2. **Show fix on the same screen as the NO-GO answer** (onboarding finale + project hero).
3. **Three-step micro-flow** always visible when blockers exist—never collapsed.
4. **Celebrate paste** — clipboard success = green check + “Now paste in Cursor (Chat or Composer)”
5. **Review again** is the sibling CTA—not buried in nav.

---

## Unified naming (all surfaces)

| Context | Label |
|---------|--------|
| Primary button | **Copy fix for Cursor** |
| Success toast | **Copied — paste in Cursor** |
| Secondary link | **How Safe Fix works** (optional tooltip, 2 lines) |
| MCP tool | Keep internal `safe_fix`; user sees “Fix this” in instructions |

Deprecate user-facing “Safe Fix Prompt” and “Copy Safe Fix” strings—grep replace in `messages/en/*.json` during implementation.

---

## Component hierarchy

### Tier 1 — Hero fix card (always when blockers)

```
┌ Fix this first ──────────────────────────────┐
│ {blocker title — plain language}             │
│ {one sentence impact}                        │
│                                              │
│ ① Copy fix for Cursor    [ PRIMARY BUTTON ] │
│ ② Paste & apply in your project              │
│ ③ Check again                                │
│                                              │
│ [ Check again ]  secondary outline           │
└──────────────────────────────────────────────┘
```

**Visual:** Slightly elevated card (`border-primary/20`, soft glow)—only colored panel on page.

**Metrics:** Show **SafeFixMetrics** inline (confidence, ~time)—max 2 chips, not a table.

### Tier 2 — Additional blockers

Collapsed **“{n} more fixes”** accordion—each row: title + small “Copy fix” text button.

**Do not** show full FastestPathForward list on onboarding finale.

### Tier 3 — Technical findings

On **Technical Details** route only—not project overview, not onboarding.

---

## Onboarding finale integration

When `status !== ready_to_ship`:

- Embed Tier 1 card **below** `ProductionVerdictHero`.
- Pre-select **top priority** fix context for `CopySafeFixPromptButton`.
- Primary footer CTA: **Check again** (triggers re-review).
- Disable double primary: if copy button is primary, “Check again” is secondary until copy succeeded once (optional delight—not required v1).

When `ready_to_ship`:

- Replace card with: “Nothing blocking deploy. Connect Cursor to ask anytime.”

---

## Project page (`/projects/:id`)

**Replace** current `ProjectSafeFixHero` layout with Tier 1 card—same as onboarding for consistency.

**Above the fold order:**

1. Deploy answer hero (verdict summary)
2. Fix card OR ready celebration
3. Single line: “Last checked {relative time}” + **Check again** text button

**Move below fold:** Production intelligence, journey teasers, technical links.

---

## Scan / report pages

- **ScanDetailView:** Keep full `ProductionVerdictExperience` for power users.
- Default entry from onboarding should **not** land here first.

---

## Empty / edge states

| State | UX |
|-------|-----|
| No blockers | Hide Tier 1; show ready copy |
| Fix copy failed | “Copy manually” expand preformatted text |
| Re-review running | Inline spinner on hero; disable CTAs |
| Still NO-GO after fix | “Still one thing to fix” — stay on top priority; no shame copy |

---

## Microcopy (fix card)

**Intro:** “Fix this first — takes about {n} minutes.”  
**Step 1:** “Copy fix for Cursor”  
**Step 2:** “Paste in Cursor and apply the change”  
**Step 3:** “Check again to update your deploy answer”  

**Tooltip:** “SequrAI writes instructions Cursor understands. You stay in control—nothing changes until you apply the fix.”

---

## Analytics (existing hooks)

Track: `safe_fix_copy`, `safe_fix_check_again`, funnel onboarding finale → copy → second verdict GO.

---

## Acceptance criteria

- [ ] 100% of NO-GO onboarding users see **Copy fix for Cursor** without scrolling on mobile (375px).
- [ ] One consistent button label across onboarding, project, verdict components.
- [ ] FastestPathForward not rendered on onboarding finale or project above-fold.
- [ ] Orphan `OnboardingSafeFixStep` deleted or merged—no dead i18n keys.

---

## Out of scope

- PR generation UI, auto-apply, new fix types.
