# MCP Agent Integrations

Data-driven registry: `lib/mcp/agent-integrations.ts`

One MCP server. Client-specific configuration only — no duplicated tools, auth, or backend.

---

## Supported agents

| Agent | Status | Local | Remote | Transport | Auth |
|---|---|---|---|---|---|
| **Cursor** | supported | ✓ | ✓ | stdio | `.sequrai/mcp.env` |
| **Claude Code** | supported | ✗ | ✓ | HTTP | API key (env) |
| **VS Code** | supported | ✗ | ✓ | HTTP | API key (env) |
| **Claude Desktop** | beta | ✗ | ✓ | HTTP | OAuth |
| **ChatGPT** | beta | ✗ | ✓ | HTTP | OAuth |
| **Codex** | unsupported | — | — | — | Not verified |
| **Gemini** | unsupported | — | — | — | Not verified |

---

## Local MCP

**Message:** "Analyze the code currently on your machine."

- Cursor via stdio bridge + installer
- Uses canonical local Production Verdict engine
- Does **not** use OAuth in Fase C

---

## Remote MCP

**Message:** "Analyze repositories connected to GitHub."

- HTTP `POST /api/mcp`
- OAuth (recommended for desktop/chat clients) or legacy API key
- Analyzes GitHub-connected repositories only
- GitHub API access for scans uses `resolveGitHubCredential()` — **GitHub App preferred**, OAuth legacy fallback (Phase D.3). MCP tools are unchanged; auth mode is transparent to agents.

See `docs/GITHUB_APP_MIGRATION.md` for installation and dual-mode details.

---

## Setup references

See `docs/MCP_OAUTH.md` for OAuth discovery and token lifecycle.  
See `docs/MCP_LOCAL_ANALYSIS.md` for local workspace analysis boundaries.  
See `docs/MCP_V1_SECURITY.md` for the full security model including legacy API keys.
