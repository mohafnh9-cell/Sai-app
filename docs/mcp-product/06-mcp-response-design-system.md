# MCP Response Design System

**Applies to:** Text returned by MCP tools (`buildTextResponse`, tool executors) — primary implementation surface for personality without new backends.

---

## Response anatomy

Every tool response follows **blocks in order**:

```
SEQURAI

{MODE LABEL}

{VERDICT LINE — one sentence, opinionated}

{COMFORT / STATUS — optional second line}

What worries me most:
- {bullet max 80 chars}
- {bullet}
- {bullet max 3}

Recommended action:
{single imperative}

{METADATA — only if useful, collapsed feel}
```

**Blank line** between blocks. No markdown walls.

---

## Mode labels (evolution from current i18n)

| Current (`mcp.json`) | Proposed user-facing | Tool |
|----------------------|----------------------|------|
| PRODUCTION REVIEW | **PROTECTION REVIEW** | review_now |
| PRODUCTION REVIEW REQUESTED | **STARTING PROTECTION REVIEW** | review_now queued |
| SAFE FIX | **FIX FOR CURSOR** | safe_fix |
| CONTINUOUS REVIEW | **REVIEW IN PROGRESS** | edge states |
| PRODUCTION HISTORY | **YOUR PROGRESS** | production_history |
| *(new framing for deploy read)* | **DEPLOY ANSWER** | can_i_deploy |

Implementation: update `messages/*/mcp.json` keys only.

---

## Verdict lines (`can_i_deploy`)

| Engine status | Verdict line |
|---------------|--------------|
| ready_to_ship | YES. I'm comfortable with you shipping this. |
| not_ready | NO. I would not deploy this application. |
| conditional / almost | NOT YET. I'm not comfortable protecting this in production yet. |
| insufficient data | I can't answer responsibly yet — I need to review your app first. |

Map from existing verdict statuses in code — no engine change.

---

## Worries block

- Source: `topPriorities` — max **3**.
- Format: plain language titles, no CVE prefix.
- Empty: “Nothing critical is blocking deploy right now.”

**Replace label:** “Production blockers:” → **“What worries me most:”**

---

## Recommended action block

| State | Action text |
|-------|-------------|
| Blockers exist | Apply Safe Fix. *(then user asks fix → safe_fix)* |
| Review stale | Run a fresh protection review. |
| Review queued | Wait for this review to finish, then ask again. |
| Ready | Ship when ready — ask me again after big changes. |
| Fix just needed | Paste the fix in Cursor, then say “Review again.” |

**Replace:** “Next action:” → **“Recommended action:”**

---

## Safe Fix response (`safe_fix`)

```
SEQURAI

FIX FOR CURSOR

{Blocker title — one line}

{Estimated time — optional}

Copy this into Cursor:

---
{prompt body}
---

After you apply the fix, say: "Review again."
```

**Remove:** “Copy the Safe Fix Prompt below into Cursor or Claude Code” redundancy — one instruction.

---

## Review now (`review_now`)

**Queued:**

```
I'm reviewing your application now.

This usually takes about two minutes.

When I'm done, ask: "Can I deploy?"
```

**Already completed:**

```
This commit was already reviewed.

Ask: "Can I deploy?" for your deploy answer.
```

---

## What changed (`what_changed`)

Lead with **human delta**:

```
Since your last review:

Score: {delta wording — improved | dropped | unchanged}

What improved:
- {resolved item or "Nothing notable"}

What worries me now:
- {new item or "Nothing new"}
```

Avoid “Detected in the latest review” as first line — move to footnote if needed for legal precision.

---

## Production history (`production_history`)

Keep short — **4 lines max** in chat:

```
YOUR PROGRESS

{Trend one word — Improving | Stable | Needs attention}

Recent: {sparkline text or last 3 scores}

Ask "Can I deploy?" for today's answer.
```

Do not dump 20 timeline rows in MCP text.

---

## Confidence / scores

**Policy:** Do not lead with numeric score.

**Optional footer** (only if user asked about health or deploy):

```
Deployment confidence: 73%
```

Rename from “Production Ready Score” in user-facing MCP strings.

**Prefer:** “I'm not comfortable yet” over score when &lt; threshold.

---

## Stale / freshness warnings

Keep warnings — shorten:

```
Note: This answer may not include your latest commit ({short sha}). Say "Review again" for a fresh answer.
```

---

## Length limits

| Tool | Max lines (target) |
|------|-------------------|
| can_i_deploy | 15 |
| safe_fix | 40 (prompt body excluded) |
| what_changed | 20 |
| production_history | 12 |
| review_now | 10 |

Host model may add **one** follow-up question — not duplicate bullets.

---

## Formatting rules

- Use `---` only around Safe Fix prompt body.
- No tables in MCP text.
- No emoji in v1 (optional ✓ later).
- ALL CAPS: only MODE LABEL and YES/NO/NOT YET line.

---

## Accessibility

- Short paragraphs.
- Bullets for lists only.
- English + Spanish full parity.

---

## Implementation checklist (future sprint)

- [ ] Update `messages/en/mcp.json` + `es`
- [ ] Update `execute-tool.ts` formatters per tool
- [ ] Align `canIDeploy` labels with design system
- [ ] Snapshot tests on golden response strings

No new tools or API fields required.
