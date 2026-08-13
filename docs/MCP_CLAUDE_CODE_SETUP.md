# SequrAI MCP — Claude Code Setup

**Verified against:** Claude Code's published MCP documentation (`code.claude.com/docs/en/mcp-servers`, `mcp-quickstart`) as of July 2026, which documents the `claude mcp add ... -- <command> [args...]` CLI syntax and the `.mcp.json` / `~/.claude.json` config file shapes referenced below. **Manually verify against your installed `claude` CLI version** (`claude --version`; run `claude mcp add --help` to confirm current flags) before relying on this for a release, since CLI flags can change between releases.

---

## 1. Get a SequrAI MCP API key

Same as Cursor: SequrAI → **Settings** → **MCP Integration** panel → **Generate key**. Copy the `seq_live_...` value immediately; it is shown once and stored server-side only as a hash.

---

## 2. Required transport

Claude Code supports two MCP transports: local **stdio** (subprocess) and remote **HTTP**. SequrAI's server is a single HTTP endpoint (`POST /api/mcp`).

- **Recommended: direct HTTP transport** — point Claude Code at `POST /api/mcp` with `Authorization: Bearer seq_live_...`. The universal install command writes this to `.mcp.json` and `~/.claude.json` automatically. No OAuth client id is required when the Bearer header is present.
- **Optional: stdio via the bundled bridge** — same bridge Cursor uses; keeps the key in `SEQURAI_API_KEY` env instead of JSON headers.

---

## 3. Option A — direct HTTP transport with API key (recommended)

Run the install command from SequrAI Settings, or:

```bash
claude mcp add --transport http sequrai \
  https://your-sequrai-deployment.example.com/api/mcp \
  --header "Authorization: Bearer seq_live_your_key_here"
```

Equivalent JSON (must include `"type": "http"` and the Bearer header):

```json
{
  "mcpServers": {
    "sequrai": {
      "type": "http",
      "url": "https://your-sequrai-deployment.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer seq_live_your_key_here"
      }
    }
  }
}
```

If Claude Code asks for a **client id**, the server entry is missing the Authorization header or `"type": "http"`. Remove the broken entry (`claude mcp remove sequrai`) and re-run the install command.

---

## 4. Option B — stdio via the bundled bridge

### CLI

```bash
claude mcp add --transport stdio sequrai \
  --env SEQURAI_API_KEY=seq_live_your_key_here \
  --env SEQURAI_API_URL=https://your-sequrai-deployment.example.com \
  -- node /absolute/path/to/sequrai-app/mcp/stdio-bridge.mjs
```

Notes:

- All of Claude Code's own flags (`--transport`, `--env`, `--scope`) must appear **before** the server name (`sequrai`). Everything after the `--` is passed to the server process untouched.
- `--scope` defaults to `local` (private, current project only). Use `--scope user` to make it available in every project, or `--scope project` to write it to `.mcp.json` and share it with teammates via git.
- `SEQURAI_API_URL` defaults to `https://sequrai-app.vercel.app` if you omit `--env SEQURAI_API_URL=...`.

### Equivalent JSON (what `claude mcp add` writes)

If you'd rather edit the config file directly (e.g. for `--scope project`, which writes `.mcp.json` at the project root so it can be committed):

```json
{
  "mcpServers": {
    "sequrai": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/sequrai-app/mcp/stdio-bridge.mjs"],
      "env": {
        "SEQURAI_API_KEY": "seq_live_your_key_here",
        "SEQURAI_API_URL": "https://your-sequrai-deployment.example.com"
      }
    }
  }
}
```

You can also add it from a JSON string directly:

```bash
claude mcp add-json sequrai '{
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/sequrai-app/mcp/stdio-bridge.mjs"],
  "env": {
    "SEQURAI_API_KEY": "seq_live_your_key_here",
    "SEQURAI_API_URL": "https://your-sequrai-deployment.example.com"
  }
}'
```

**Windows note:** on native Windows (not WSL), stdio servers launched via `node` sometimes need a `cmd /c` wrapper to avoid "Connection closed" errors: `-- cmd /c node C:\path\to\stdio-bridge.mjs`. Verify this against your setup if you're on Windows.

---

## 5. Verifying the connection

```bash
claude mcp list        # confirms "sequrai" is registered and its transport
claude mcp get sequrai # shows the exact command/url/env Claude Code will use
```

Inside a Claude Code session, run `/mcp` to see live server status and confirm the five tools (`can_i_deploy`, `safe_fix`, `what_changed`, `production_history`, `deployment_confidence`) are listed.

---

## 6. Example calls

Ask Claude Code natural-language questions and it will select the right tool:

- "Can I deploy this?" → `can_i_deploy`
- "List my current production blockers and generate a fix for the top one." → `safe_fix` (list mode, then prompt mode with a `blockerId`)
- "What changed since my last review?" → `what_changed`
- "Show my score trend for the last 7 days." → `production_history` with `range: "7d"`
- "Give me your honest deployment recommendation." → `deployment_confidence`

---

## 7. Project selection

Identical rules to Cursor (see `docs/MCP_CURSOR_SETUP.md` §6): omit the project selector when your organization has one project; expect an `ambiguous_project` error with a project list otherwise; SequrAI always re-validates any `projectId`/`repositoryFullName` you pass against your API key's organization server-side.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `claude mcp add` succeeds but `/mcp` shows no tools | Bridge process crashed on startup (e.g. bad path) | Run the exact `command`/`args` manually in a terminal to see the error; check `claude mcp get sequrai` for the resolved command |
| `unauthorized` / `invalid_api_key` on every call | Missing, wrong, or revoked API key | Regenerate a key in SequrAI Settings; update with `claude mcp remove sequrai` then re-add, or edit `.mcp.json`/`~/.claude.json` directly |
| stdout is corrupted / "Connection closed" | Something other than the bridge is writing to stdout (e.g. a dotenv loader logging a banner) | The bridge only writes JSON-RPC to stdout and logs to stderr; if you wrapped it in another script, make sure that script does the same |
| `project_not_found` | Wrong ID, or project belongs to another org | Omit the selector to auto-select, or call any tool with none to get the `ambiguous_project` list |
| `no_verdict_available` | Project has no completed Production Review yet | Trigger a scan/push a commit in SequrAI first |
| Works with `--scope local` but teammates can't see it | `local` scope is private to you | Re-add with `--scope project` so it's written to the committed `.mcp.json` |

---

## 9. Key revocation

Same flow as Cursor: SequrAI → Settings → MCP Integration → **Revoke** next to the key. Revocation is immediate and irreversible; generate a new key and run `claude mcp remove sequrai && claude mcp add ...` (or edit the config file's `env`/`headers` in place) with the new value.
