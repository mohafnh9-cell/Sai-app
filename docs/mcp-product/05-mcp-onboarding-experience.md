# MCP Onboarding Experience

**Goal:** User talks to SequrAI in Cursor in **&lt; 60 seconds** and gets a **magical, opinionated** first answer.  
**No new backend** — setup uses existing API keys + `/api/mcp`.  
**Web onboarding alignment:** [../ux-sprint/04-mcp-onboarding-redesign.md](../ux-sprint/04-mcp-onboarding-redesign.md)

---

## Mental model to install

**Before setup:** “SequrAI is a website.”  
**After setup:** “SequrAI is my production engineer in Cursor.”

User should **never** read the words “MCP server.”

---

## Onboarding acts

| Act | Where | Duration |
|-----|-------|----------|
| 1. Connect code | Web (GitHub) | Before or parallel |
| 2. Connect Cursor | Web wizard or Settings | 60s |
| 3. First question | Cursor chat | 30s |
| 4. Habit hook | Suggested chips | Ongoing |

This doc covers **Acts 2–4** (MCP-native).

---

## Act 2 — Connect Cursor (60s)

### Step copy

**Title:** Connect SequrAI to Cursor  
**Subtitle:** Ask deploy and protection questions without leaving your editor.

1. **Create connection** — “Generate key” → show once → Copy  
2. **Add to Cursor** — Copy `mcp.json` snippet → Settings → MCP  
3. **Try it** — Copy chip: **Can I deploy?**

**Success line:** “You’re connected. SequrAI is in Cursor now.”

### Snippet content (logical)

- Server URL: production `/api/mcp`
- Auth: Bearer key
- No mention of stdio bridge in user-facing copy (bridge remains for advanced docs)

### Failure recovery

- Invalid key → regenerate
- Wrong file path → show `~/.cursor/mcp.json` (macOS first)

---

## Act 3 — First question (scripted success path)

**Recommended first messages** (pick one chip):

| Chip | Expected tool | Expected feel |
|------|---------------|---------------|
| Can I deploy? | `can_i_deploy` | Decisive YES/NO |
| Protect my application | `review_now` | “I’m reviewing…” |
| What worries you? | `can_i_deploy` | Three worries max |

**First response must:**

- Start with `SEQURAI` + mode label (evolve labels in doc 06)
- Follow personality doc 03
- Include **one** next action

**If no verdict yet:**

- SequrAI says: “I haven’t reviewed this app yet — starting now.” → `review_now`
- Not a technical error dump

---

## Act 4 — Habit hooks

After first success, host instructions suggest user pin:

- “Ask SequrAI before every deploy.”
- Suggested weekly: “What changed this week?” (`what_changed` + `production_history`)

**Optional Cursor rules snippet** (documentation only):

```text
Before pushing to production, ask SequrAI: "Can I deploy?"
```

Ship as copy-paste in setup wizard — not a new product feature.

---

## Server instructions (first-run)

When implementation updates `MCP_SERVER_INSTRUCTIONS`, add:

- Intro paragraph: “You are the user’s Production & Protection Engineer…”
- First-time: if `no_verdict_available`, proactively offer `review_now`
- Never explain MCP protocol to user

---

## Tool descriptions (first-run)

First line of each description should be **user-intent shaped**:

- `can_i_deploy`: “Answer whether you’re comfortable deploying and protecting this app…”
- `review_now`: “Run a protection review on latest code…”

Full text in doc 08 + existing `tool-descriptions.ts` — align in implementation.

---

## Claude Code parity

Same three steps; step 2 references Claude Code config path in help link — no duplicate backend.

---

## Docs to de-emphasize for founders

Move technical depth to “Advanced”:

- `MCP_V1_IMPLEMENTATION.md`
- stdio bridge internals

Keep:

- `MCP_CURSOR_SETUP.md` — simplified to match wizard verbatim

---

## Success criteria

| Metric | Target |
|--------|--------|
| Setup time (key → first message sent) | ≤ 60s P95 |
| First message gets tool call (not pure LLM guess) | ≥ 90% |
| User can paraphrase product | “Tells me if I can ship / protects my app” |

---

## Out of scope

- In-MCP onboarding UI (no MCP resources for wizard).
- Auto-install Cursor extension.
- Continuous protection messaging in MCP (not built).
