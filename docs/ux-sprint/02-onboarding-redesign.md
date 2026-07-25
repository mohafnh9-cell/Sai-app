# Onboarding Redesign

**Principle:** One question per screen — **“What should I do next?”**

**Target path (&lt; 5 min to Ready to Ship or clear fix loop):**

```
Sign Up → Connect GitHub → Select Repository → First Deploy Answer 
  → (if needed) Fix in Cursor → Check Again → Ready to Ship → Connect Cursor
```

---

## Structural change: 6 steps → 5 visible moments

| # | Screen ID | User question answered | Remove / merge |
|---|-----------|------------------------|----------------|
| 1 | `welcome` | “What’s my space called?” | Keep; rename copy only |
| 2 | `github` | “How do I connect my code?” | Keep |
| 3 | `repository` | “Which app?” | Keep; one repo only in v1 UX |
| 4 | `review` | “Is SequrAI done yet?” | Keep; add time expectation |
| 5 | `finale` | **“Can I ship? What’s next?”** | **Merge `verdict` + `dashboard` + Safe Fix entry** |
| 6 | `cursor` (optional) | “How do I use this in Cursor?” | **New finale sub-step or slide** — MCP only, no new backend |

**Delete as separate wizard steps:** `verdict` → part of `finale`; `dashboard` → default navigation after `finale` primary CTA.

---

## Progress tracker redesign

Replace engineer labels with founder labels (i18n keys updated in implementation):

| Old (`progress.*`) | New user-facing |
|--------------------|-----------------|
| GitHub connected | **GitHub connected** ✓ |
| Repository selected | **App selected** ✓ |
| Production Review completed | **Check complete** ✓ |
| Production Verdict received | **Deploy answer ready** ✓ |
| Ready to deploy | **Ready to ship** ✓ |

**Hide progress on `welcome`** — show tracker only from GitHub onward (Apple-style: don’t show 0/5 before start).

---

## Screen specs

### 1. Welcome

**Headline:** “Let’s see if your app is ready to ship.”  
**Sub:** “About 3 minutes. No security expertise needed.”  
**Field label:** “What should we call your team?” (not “Workspace name”)  
**Button:** “Continue”  
**Remove:** Paragraph about “Production Reviews.”

---

### 2. GitHub

**Headline:** “Connect GitHub”  
**Sub:** “We read your repo to give you a clear deploy answer. We never change your code.”  
**Button:** “Connect GitHub”  
**Scopes:** Collapsed accordion default closed; one line trust badge.

---

### 3. Repository

**Headline:** “Which app should we check?”  
**Sub:** “Pick the repository you’re about to deploy.”  
**Button on row:** “Check this app” (not “Review this repository”)  
**Auto-advance:** Keep — select → review starts.

---

### 4. Review (waiting)

**Headline:** “Checking your app…”  
**Sub:** “Usually under 2 minutes.”  
**Stages:** Keep friendly `reviewStages.*` — reduce list visibility to **current stage + subtle progress bar** (not 9 lines at once).  
**On complete:** Auto-advance to `finale` — **no button**.

**Remove:** Second “Building your Production Verdict” on next screen.

---

### 5. Finale (merged verdict + next action + optional Safe Fix)

**Layout (single scroll, max 2 viewport heights):**

```
┌─────────────────────────────────────────┐
│  DEPLOY ANSWER  (eyebrow, not "Verdict")│
│  ┌───────────────────────────────────┐  │
│  │ ProductionVerdictHero (product)    │  │
│  │ YES / NO / ALMOST + confidence     │  │
│  └───────────────────────────────────┘  │
│                                         │
│  IF NO or ALMOST:                       │
│  ┌─ Fix this first ─────────────────┐  │
│  │ One sentence: what's wrong        │  │
│  │ [ Copy fix for Cursor ]  PRIMARY │  │
│  │ "Paste in Cursor, apply, return"  │  │
│  └───────────────────────────────────┘  │
│                                         │
│  IF YES:                                │
│  Celebration line + confetti subtle       │
│                                         │
│  Secondary: "Open project" link         │
│  Primary CTA:                           │
│    NO → "I've fixed it — check again"   │
│    YES → "Connect Cursor" → step cursor   │
│    YES skip → "Go to dashboard"         │
└─────────────────────────────────────────┘
```

**Copy rules:**

- No button labeled “View Production Verdict” on this screen.
- **One primary button** only.
- “Next action” section uses **verb-first** title from top priority (truncate to 80 chars).

**Behavior:**

- “Check again” triggers same review API as `AnalyzeProjectButton` with loading inline → refresh hero in place (stay on finale).
- After second GO → animate to Ready to Ship state → primary becomes “Connect Cursor”.

---

### 6. Connect Cursor (MCP onboarding — see doc 04)

Embedded as `step=cursor` or finale panel slide — not Settings.

**Headline:** “Use SequrAI inside Cursor”  
**Sub:** “Ask ‘Can I deploy?’ anytime.”  
**Steps:** 3 numbered (copy key → paste mcp.json → reload Cursor)  
**Button:** “Copy setup” + “I’m connected”  
**Skip:** “Skip for now” → `/projects/:id?onboarded=1`

---

## URL / routing

| URL | Meaning |
|-----|---------|
| `/onboarding` | Resume smart step |
| `/onboarding?step=finale&projectId=` | Deep link post-review |
| `/onboarding?step=cursor&projectId=` | MCP setup |
| `/projects/:id?onboarded=1` | Post-onboarding banner (doc 06) |

**Legacy aliases:** Keep `safefix` → `finale`, `mcp` → `cursor` in `onboarding-flow.ts` when implementing.

---

## Completion semantics (UX recommendation)

**Do not** mark onboarding complete until user clicks **“Go to dashboard”** or **“I’m connected”** on cursor step—not merely when verdict row exists. (Requires small logic change in implementation sprint—flag as UX requirement, not feature.)

---

## Copy pack (English defaults)

| Key moment | String |
|------------|--------|
| Page title | “Ready to ship?” |
| NO-GO hero | “Not yet — but you’re close.” |
| GO hero | “You’re ready to ship.” |
| Safe Fix intro | “Fix this first in Cursor (about {n} min)” |
| Check again | “Check again” |
| Connect Cursor | “Connect Cursor” |

Spanish: mirror in `messages/es/onboarding.json` in implementation.

---

## Acceptance criteria

- [ ] User reaches deploy answer without clicking through a blank “building verdict” after scan.
- [ ] User sees **Copy fix for Cursor** on same screen as NO-GO answer.
- [ ] ≤ 1 primary CTA per onboarding screen.
- [ ] Progress labels pass “founder read-aloud” test (no “Production Review completed”).
- [ ] Median time from repo select to finale visible ≤ 2 min P95 (engineering metric).
- [ ] Optional Cursor step reachable in &lt; 60 s from GO state.

---

## Wireframe note

Implementation uses existing components: `ProductionVerdictHero`, `CopySafeFixPromptButton`, `McpApiKeysPanel` content inlined into new `OnboardingCursorStep` (refactor UI only).

**Do not wire** orphan `OnboardingSafeFixStep` / `OnboardingMcpStep` without new copy keys—merge into `finale` + `cursor` per this spec.
