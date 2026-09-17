# Auto-Security MVP — manual setup (pilot)

This is the smallest reliable Auto-Security trigger: your coding agent's
own hook system calls SequrAI's existing local security pipeline after
security-relevant edits, coalesced to run once per agent turn.

**Not auto-installed yet** (deliberate scope decision for the 10-day pilot
— see the Auto-Security MVP final report). Until installer wiring lands,
set this up manually once per developer:

1. Run the normal SequrAI installer first (`sequrai_local_audit` must
   already work via `~/.sequrai/stdio-bridge.mjs`).
2. Copy `auto-security-hook.mjs` next to it:
   ```bash
   curl -fsSL https://sequrai-app.vercel.app/mcp/auto-security-hook.mjs -o ~/.sequrai/auto-security-hook.mjs
   ```
3. **Claude Code**: merge [`claude-code-settings.json`](./claude-code-settings.json)'s
   `hooks` block into your project's `.claude/settings.json` (or
   `~/.claude/settings.json` for all projects).
4. **Cursor**: merge [`cursor-hooks.json`](./cursor-hooks.json)'s `hooks`
   block into `.cursor/hooks.json` (project) or `~/.cursor/hooks.json`
   (all projects).
5. Restart the agent.

## What this does

- After each file edit (`PostToolUse`/`afterFileEdit`), the hook silently
  records the changed path. No scan runs here.
- When the agent finishes its turn (`Stop`/`stop`), the hook classifies the
  batch of changed files. If none look security-relevant (docs/formatting
  only), nothing happens. Otherwise it runs the SAME `sequrai_local_audit`
  pipeline every other SequrAI tool uses, and returns a short summary back
  to the agent.
- A duplicate `Stop` with no real code change since the last automatic
  review never re-scans.

## What this does NOT do

- No background process, daemon, or timer — every invocation is a
  short-lived subprocess started by the agent itself.
- No new scanner, orchestrator, or verdict logic — see
  `lib/local-analysis/auto-security-trigger.ts`'s own doc comment.
- "No finding detected" is never presented as "verified" or "secure" — see
  `formatAutoSecurityFeedback`'s wording.
