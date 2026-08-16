# D.11 — Local Intelligence Layer

SequrAI analyzes your code **while you build** — before you commit, before you push, and before you deploy.

This document describes the **local MCP audit** shipped in D.11. It does not replace GitHub-connected workflows.

---

## What local analysis does

When your code agent uses the SequrAI **stdio bridge** (Cursor, Claude Code with local bridge):

1. Resolves the **authorized workspace root** (`SEQURAI_WORKSPACE_ROOT`, set by the installer)
2. Walks the workspace with security exclusions and size limits
3. Optionally scopes to git changes (`workspace`, `working_tree`, `staged`, `diff`)
4. Builds `InputFile[]` and runs the **existing** `scanRepository()`
5. Feeds findings into the **canonical** Production Verdict engine (`brain/production-verdict/engine.ts`)
6. Returns a structured local Production Verdict with safe snapshot metadata

**Primary tool:** `sequrai_local_audit`  
**Alias:** `audit_local_project` (same implementation)

Example prompt:

> Audit this project with SequrAI.

---

## What local analysis does NOT do

Local audit does **not**:

- Upload your source code to SequrAI servers (analysis runs on your machine)
- Require GitHub, a connected repository, commit, push, or webhooks
- Run dynamic security tests or attack simulation
- Persist verdicts to Supabase
- Create GitHub Check Runs
- Answer `can_i_deploy` (that requires a persisted GitHub verdict)
- Scan your entire computer — only the **authorized project workspace**

Local audit **is** a canonical **static** Production Verdict for the files it actually analyzed.

---

## Local vs GitHub analysis

| | Local (`sequrai_local_audit`) | Remote / GitHub (`review_now`, `full_product_audit`, `can_i_deploy`) |
|--|-------------------------------|------------------------------------------------------------------------|
| **Source** | `local` | `github` / `pr` |
| **Where it runs** | Your machine (stdio bridge) | SequrAI server |
| **GitHub required** | No | Yes (connected project) |
| **Uncommitted files** | Yes | No (GitHub commit/ref) |
| **Dynamic tests** | No | Yes (full product audit) |
| **Persistence** | Ephemeral | Supabase |
| **CI / Check Runs** | No | Yes |

Recommended flow:

1. **Local:** `sequrai_local_audit` before commit
2. **GitHub:** push → remote review / CI when repository is connected
3. **Deploy:** `can_i_deploy` after a GitHub-backed verdict exists

---

## Privacy model

- Analysis runs **client-side** in the bundled local runtime
- Source file contents are **not** sent to `/api/mcp` for local-only tools
- Remote tools still use HTTPS + Bearer token and analyze **GitHub**, not arbitrary local paths
- API keys live in `.sequrai/mcp.env` (gitignored, mode 600) — never commit them

Snapshot metadata (safe to return):

- `filesAnalyzed`, `filesExcluded`, `bytesAnalyzed`, `truncated`, `credentialsSkipped`
- Git branch/SHA and change counts when git is available

Never returned: raw secret values, full `.env` contents, Authorization headers.

---

## Workspace boundary

- **Authorized root:** `SEQURAI_WORKSPACE_ROOT` (installer sets this to your project folder)
- **Optional nested path:** `workspacePath` may select a subdirectory **inside** the root only
- **Rejected:** `../` traversal, encoded traversal, paths outside root, symlink escapes

---

## Files excluded

**Directories (default):** `.git/`, `node_modules/`, `.next/`, `dist/`, `build/`, `coverage/`, `vendor/`, `target/`, `.cache/`, `.turbo/`, `.vercel/`

**Credential-like files (walk-time denylist):** `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, keys, credential/secret filenames, service account JSON

**Also respected:** `.gitignore`, `.sequraiignore`

**Still analyzed:** legitimate source files, `package-lock.json`, `.env.example`

**Skipped:** binary files (null-byte detection)

---

## Limits (aligned with GitHub scan limits)

| Limit | Value |
|-------|-------|
| Max files | 200 |
| Max file size | 256 KB |
| Max total snapshot | 5 MB |
| Max directory depth | 18 |

If limits are exceeded, `snapshot.truncated = true` and the canonical verdict **fails closed** (`insufficient_data`). SequrAI never returns `ready_to_ship` on incomplete evidence.

---

## Git scopes

| Scope | Analyzes |
|-------|----------|
| `workspace` | All readable in-scope files (default) |
| `working_tree` | Files with local git changes |
| `staged` | Staged changes only |
| `diff` | Unstaged diff only |

Non-git projects: only `workspace` is supported. Git-specific scopes return a clear `insufficient_data` message.

Changed-file scopes analyze **full file contents**, not patch hunks alone.

---

## Secret handling

1. **Walk-time denylist** — obvious credential files never enter the snapshot (`credentialsSkipped` count only)
2. **Scanner rules** — `secrets.exposed` and classification for in-source patterns
3. **Redaction** — evidence in responses uses existing redaction helpers

---

## Authentication

- Stdio bridge requires `SEQURAI_API_KEY` for MCP protocol (including local tools)
- Generate keys in SequrAI **Settings → Connect my agent**
- Before Claude Code: `source .sequrai/mcp.env`

---

## Setup

### Cursor (recommended for local audit)

Run the installer from your project folder (see Settings → Connect my agent). Restart Cursor fully.

### Claude Code / VS Code

HTTP remote tools work with OAuth/API key. **Local audit requires the stdio bridge** installed for Cursor-style setup.

---

## Example prompts

- “Audit this project with SequrAI.”
- “Analyze my current workspace before I commit.”
- “Review my staged changes.”
- “What’s my local Production Verdict?”

After connecting GitHub:

- “Can I deploy?” → `can_i_deploy` (remote, persisted)
- “Run a full product audit.” → `full_product_audit` (remote)

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| Local tools missing | Re-run installer; verify stdio bridge path in `.cursor/mcp.json` |
| `SEQURAI_API_KEY is required` | `source .sequrai/mcp.env` |
| `insufficient_data` | Empty workspace, no git changes in scope, or snapshot limits hit |
| `workspace_path_not_authorized` | Do not pass paths outside the authorized root |
| `can_i_deploy` stale / empty | Expected — connect GitHub and run a remote review first |

---

## Build

```bash
npm run build:mcp-local
```

Produces `public/mcp/local-verdict-bundle.mjs` consumed by the stdio bridge. Integrity checksums are listed in `public/mcp/install-manifest.json`.

---

## Related docs

- `docs/MCP_LOCAL_ANALYSIS.md` — MCP tool reference
- `docs/LOCAL_GITHUB_CORRELATION.md` — optional local ↔ GitHub finding correlation (web API)
