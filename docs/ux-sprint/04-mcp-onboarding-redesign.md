# MCP Onboarding Redesign

**Goal:** MCP setup in **&lt; 60 seconds**, feels **magical**, not like reading AWS docs.

**Constraint:** Reuse existing `/api/mcp`, key generation API, `McpApiKeysPanel` logic—**UX and copy only**. No new MCP tools.

---

## Problems today

- MCP only in **Settings**—discovered after users leave onboarding.
- No link to `docs/MCP_CURSOR_SETUP.md` from app.
- Orphan **OnboardingMcpStep** with missing translations + inconsistent JSON paths.
- User doesn’t know **what to say** after setup (“Can I deploy?”).

---

## Placement

### Primary: onboarding finale branch

After **Ready to Ship** (or user skips fix loop):

**Step `cursor`** — full-screen simple wizard (3 micro-steps).

### Secondary: Settings

Keep **AI agent connection** card for key rotation—same copy as onboarding.

### Tertiary: Project banner

Link: “Ask in Cursor →” for returning users.

---

## Connect Cursor wizard (3 steps)

```
Step 1 of 3 — Create connection
  "We’ll give you a one-time key."
  [ Generate key ]  (or auto-generate on enter)
  Key shown once with [ Copy key ]

Step 2 of 3 — Add to Cursor
  Side-by-side:
  Left: numbered instructions (3 lines)
  Right: syntax-highlighted mcp.json snippet
  [ Copy snippet ]
  Path hint: "Cursor → Settings → MCP → Edit config"

Step 3 of 3 — Try it
  "Open Cursor and ask:"
  ┌────────────────────────────────────┐
  │ Can I deploy?                      │  (copy chip)
  └────────────────────────────────────┘
  [ Copy question ]  [ I did it — finish ]
```

**Skip:** “Skip for now” → project with banner reminder.

---

## Magic moments

1. **Auto-generate key** on step enter—user never hunts Settings.
2. **Single “Copy all setup”** button copies JSON with key injected (reduces 2 copies to 1).
3. **Success screen:** “You’re connected. SequrAI lives in Cursor now.” + subtle animation.
4. **First MCP question chip** pre-filled—user feels guided, not configured.

---

## Copy (founder language)

| Avoid | Use |
|-------|-----|
| MCP | **Cursor connection** / **SequrAI in Cursor** |
| API key | **Connection key** |
| stdio bridge | *(don’t mention)* |
| Tool surface | *(don’t mention)* |

**Settings card title:** “Cursor & Claude Code”  
**Subtitle:** “Ask deploy questions from your editor.”

---

## Claude Code

Second tab on step 2: “Using Claude Code?” — link to existing doc path in help link (implementation: external doc link, not new feature).

---

## Error states

| Error | Message |
|-------|---------|
| Key gen failed | “Try again” + support link |
| No key copied | Warn before leaving step 1 |
| Invalid path | Show macOS default `~/.cursor/mcp.json` only in v1 |

---

## Relationship to Product Bible

MCP is the main product—but **this sprint** only adds onboarding UX to reach existing five tools. Do not add sixth tool UI.

**Suggested first questions** (chips):

- Can I deploy?
- What worries you about my app?
- Review my project again

Maps to existing tools via client instructions (copy update in `MCP_CLIENT_INSTRUCTIONS` / settings help—not new backend).

---

## Settings page alignment

- Match snippet format to onboarding wizard **exactly**.
- Add “Setup guide” link opening modal with same 3 steps (not raw markdown file).
- Remove duplicate placeholder inconsistencies.

---

## Acceptance criteria

- [ ] New user can complete Cursor setup without visiting Settings.
- [ ] Median time step 1→3 ≤ 60 seconds in usability test (n ≥ 5).
- [ ] Zero references to “MCP” in onboarding wizard body copy.
- [ ] `OnboardingMcpStep` replaced by `OnboardingCursorStep` spec above.
- [ ] Docs linked from help modal optional; wizard self-contained.

---

## Out of scope

- VS Code, Windsurf, custom servers, OAuth MCP, team keys.
