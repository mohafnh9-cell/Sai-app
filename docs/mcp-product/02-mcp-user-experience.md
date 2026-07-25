# MCP User Experience

## Experience goal

**Jarvis for AI-built software** — calm, decisive, on your side.  
**Cursor’s best friend** — shows up where you already work.  
**Senior engineer** — opinionated, not encyclopedic.

The user never configures “an integration”; they **hire** SequrAI once and talk to it.

---

## Primary user stories

| As a founder… | I want to… | So that… |
|---------------|------------|----------|
| …about to ship | Ask if I can deploy | I don’t push broken auth to prod |
| …anxious | Ask if I’m protected | I feel peace of mind |
| …confused by a NO | Know what worries SequrAI most | I fix one thing, not fifty |
| …after a fix | Review again | I see updated comfort level |
| …curious | Ask what changed | I know if I made it better or worse |
| …planning | Ask how healthy the app is | I see trend, not one score |
| …stuck | Get a fix for Cursor | I act without reading security docs |

---

## Interaction patterns

### Pattern 1 — Deploy gate (most common)

```
User: Can I deploy?
SequrAI: [decisive NO/YES] → worries (≤3) → one action
```

**Tool:** `can_i_deploy` only.  
**Time to value:** &lt; 5 seconds (read path).

### Pattern 2 — Protect / review

```
User: Protect my application.
SequrAI: [acknowledge] → review_now → [when complete] comfort summary
```

**Tools:** `review_now`, then `can_i_deploy` (host or user follow-up).  
**Copy:** “I’m reviewing your application” not “Starting scan job.”

### Pattern 3 — Fix loop

```
User: Fix this problem.
SequrAI: safe_fix → paste instructions → suggest review again
```

**Tool:** `safe_fix`; optional follow-up phrase triggers `review_now`.

### Pattern 4 — Retrospective

```
User: What changed? / How healthy am I?
SequrAI: what_changed and/or production_history — short
```

Never use history alone for “can I deploy right now?”

---

## UX principles

1. **Answer first** — First line is YES / NO / NOT YET / SAFE WITH CAUTION.
2. **Worries, not vulnerabilities** — Max three bullets.
3. **One next action** — Safe Fix, review again, or wait for review.
4. **No tool names** — User never sees `review_now`.
5. **No scores without meaning** — Prefer “I’m not comfortable yet” over “72.”
6. **Stale honesty** — Say when answer may be outdated; offer review.
7. **Compound requests** — Order tools; one unified message where possible.

---

## Failure UX

| Situation | User-facing behaviour |
|-----------|------------------------|
| No verdict yet | “I haven’t reviewed this app yet. I’ll review it now.” → `review_now` |
| Review running | “Still reviewing — I’ll have your deploy answer shortly.” |
| Ambiguous project | “Which app?” — list names only |
| No GitHub | Link to web connect — one sentence |
| Rate limited | “Give me a moment — try again in 30 seconds.” |

Errors use `messages/en/mcp.json` keys — reword in implementation to personality (doc 03).

---

## Locale

- English and Spanish parity for all modes and errors.
- Mode labels may change in implementation (e.g. DEPLOY ANSWER vs PRODUCTION REVIEW) — doc 06.

---

## Host model behaviour (instructions)

Server instructions (`client-instructions.ts`) must enforce:

- Call tools for deploy/protection truth.
- SequrAI voice in final reply (personality doc).
- Concise structure; no host “let me analyze…” before tool call.

---

## What users should not experience

- Walls of findings.
- CVE IDs as primary content.
- “Security score: X” without interpretation.
- Multiple equally weighted CTAs.
- “As an AI language model…”

---

## Accessibility of intent

Users type **how they speak** — see doc 04.  
Tool selection is the **client’s job**; SequrAI optimizes descriptions + instructions so Cursor/Claude pick correctly.

---

## Onboarding UX (summary)

First minute in Cursor: doc 05.  
Success: user asks “Can I deploy?” and gets opinionated answer without reading docs.

---

## Differentiation

| Generic Claude | SequrAI MCP |
|----------------|-------------|
| Guesses from code context | Reads **persisted verdict** |
| Lists issues | **Would not deploy** + why |
| No memory of past reviews | `production_history`, `what_changed` |
| No fix prompt discipline | **Safe Fix** scoped to blocker |

User should feel: **“I’d rather ask SequrAI than ask Claude.”**
