# MCP Product Specification

**Principle:** The MCP is the main product. The web app supports configuration and visibility.

**V1 tool surface (locked):** Five canonical tools per ADR-001:

1. `review_now`
2. `can_i_deploy`
3. `safe_fix`
4. `what_changed`
5. `production_history`

All natural-language intents map to these five until the bible is amended.

---

## Product positioning in MCP

Server instructions must lead with **protection**, not scanning:

- “SequrAI continuously protects your AI-built application.”
- “Ask if you’re protected, if you can deploy, or what worries us about your project.”

Tone: calm, confident, founder-friendly (Cursor/Linear-like).

---

## Intent → tool mapping

| User says (examples) | Primary tool | Notes |
|----------------------|--------------|-------|
| Can I deploy? / Ready to ship? / Ship to prod? | `can_i_deploy` | Returns verdict + confidence |
| Protect my application / Review my project | `review_now` | Starts protection review |
| Am I protected? / Protection status | `can_i_deploy` + health fields | Composite “protected” boolean in response |
| What worries you? / Biggest risks | `can_i_deploy` or last verdict summary | Top 3 “worries” |
| Would you deploy if it was your company? | `can_i_deploy` | Same engine; copy variant |
| Fix this / Safe fix / How do I fix X | `safe_fix` | Blocker/priority/finding scoped |
| Review again / Re-check after fix | `review_now` | `reason: after_fix` |
| What changed? / Since last review | `what_changed` | Diff narrative |
| How healthy? / Production health | `production_history` + health | Trend + latest |
| Investigate this issue | `review_now` + `what_changed` | Compound: clarify in one response |
| Show history / Past reviews | `production_history` | Timeline narrative |

**Ambiguous phrases** (“check my app”) → disambiguation prompt: deploy vs protect vs history.

---

## Tool specifications (behavioural)

### `review_now`

- **Purpose:** Run protection review on selected project/commit.
- **Inputs:** project selector, optional branch/sha, `reason` enum.
- **Output:** Progress acknowledgment if async; then protection summary, confidence deltas, next action.
- **UX:** Never dump raw scanner logs; use worries + confidence.

### `can_i_deploy`

- **Purpose:** Deploy gate — the canonical GO/NO-GO.
- **Output structure:**
  - `protected` / `readyToShip` (boolean)
  - `productionConfidence`, `securityConfidence` (0–100)
  - `attackSurface` (LOW/MED/HIGH)
  - `worries` (max 3, plain language)
  - `verdict` (GO / NO-GO / CONDITIONAL)
  - `nextAction` (single CTA: Safe Fix, review again, connect repo)
- **Latency:** Target &lt; 2 min fresh; stale verdict with age + “review again” if &gt; 24h.

### `safe_fix`

- **Purpose:** Generate approved Safe Fix prompt or scoped fix plan.
- **Output:** Fix prompt, confidence, estimated time, link to open PR flow on web if enabled.

### `what_changed`

- **Purpose:** Protection-relevant diff since last memory snapshot.
- **Output:** New/changed findings, confidence delta, surface changes.

### `production_history`

- **Purpose:** Memory-backed narrative.
- **Output:** Reviews, verdicts, prevented unsafe deploys (when recorded), fixes applied.

---

## MCP prompts (bundled)

Three bundled prompts (existing pattern), reframed:

1. **Before deploy** — “Protect before I ship.”
2. **After fix** — “I fixed something—am I protected again?”
3. **Weekly check-in** — “What should worry me this week?”

Each prompt lists allowed tools and expected user outcome.

---

## Onboarding experience (&lt; 60 seconds)

1. User adds MCP URL + auth in Cursor (documented one-pager).
2. First message suggestion: **“Protect my application”** or **“Can I deploy?”**
3. If no project linked → MCP returns single link to web onboarding (no dead-end).
4. First successful review → MCP confirms **“You’re on continuous protection”** (default ON).

**Success metric:** Time to first tool success &lt; 60s for user with repo already connected.

---

## Protection workflows (end-to-end)

### Workflow A — First ship

```
Protect my app → review_now → can_i_deploy → (NO-GO) → safe_fix → user fixes → review_now (after_fix) → can_i_deploy (GO)
```

### Workflow B — Stay protected

```
(continuous jobs run) → alert if needed → user asks "am I protected?" → can_i_deploy + history
```

### Workflow C — Something broke

```
Investigate → what_changed + review_now → safe_fix → PR approval on web → review_now → can_i_deploy
```

---

## Response design rules

1. **Lead with the answer** — Yes/no protected, yes/no deploy.
2. **Three worries max** — Additional detail on request.
3. **No CVE spam** — Translate to “what could happen to your users/business.”
4. **Always one next action.**
5. **Never expose secrets** — No tokens, env values, full file contents.
6. **Locale** — `en` / `es` supported.

---

## Error states

| State | MCP behaviour |
|-------|----------------|
| No GitHub token | “Connect GitHub to protect this project” + link |
| Scan running | “Protection in progress—check back in ~2 min” + job id optional |
| Rate limited | Honest wait + retry |
| Project ambiguous | Ask to pick project (internal list_projects, not public tool) |

---

## Analytics (product)

Track intent routing accuracy, tool success rate, time-to-first-verdict, MCP WAU—see doc 12.

---

## Future (architecture only)

- Sixth tool `am_i_protected` if five-tool cap lifted.
- Voice-style compound agent (still maps to same backend).
- MCP resources for report PDFs.

Not Hybrid V1 unless promoted in doc 03.
