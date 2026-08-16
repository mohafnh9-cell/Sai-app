# SequrAI Local MCP Analysis

SequrAI can analyze code **inside your authorized workspace** without uploading the whole repository to the server.

## What runs locally

When you use Cursor with the SequrAI stdio bridge, these tools execute on your machine:

| Tool | Purpose |
|------|---------|
| `sequrai_local_status` | Workspace readiness, branch, git status |
| `sequrai_local_audit` | **Local Production Verdict** (canonical engine, static local evidence) |
| `audit_local_project` | Alias of `sequrai_local_audit` |
| `sequrai_local_review` | Preview staged/unstaged changes |
| `sequrai_local_findings` | Actionable local findings |
| `sequrai_local_prepare` | Sanitized manifest (no automatic upload) |

The 9 remote tools (`full_product_audit`, `can_i_deploy`, …) call SequrAI over HTTPS with **OAuth** or a legacy `seq_live_*` API key and analyze your **GitHub-connected repository**. Remote OAuth does **not** access your local filesystem.

**Local:** "Analyze the code currently on your machine."  
**Remote:** "Analyze repositories connected to GitHub."

## Source separation

| Source | What it analyzes |
|--------|------------------|
| `local` | Files on disk in the authorized workspace |
| `github` | Connected repository via remote MCP tools |
| `pr` | Pull request head commit (GitHub automation + PR page) |

Never mix them silently. Local tools always return `"source": "local"`. Remote verdict tools return `"source": "github"` or `"source": "pr"` when tied to a PR scan.

Local MCP is **not** affected by GitHub App migration (Phase D.3). No installation tokens, OAuth scopes, or workspace uploads apply to stdio local analysis.

**Phase D.7 — Local ↔ GitHub correlation:** Local findings include a deterministic `correlationKey` (rule + normalized path + fingerprint material). Compare against GitHub via `POST /api/projects/{id}/local-correlation` or Mission Control UI. See `docs/LOCAL_GITHUB_CORRELATION.md`. GitHub persisted verdict remains authoritative.

## Security model

- **Authorized workspace root**: set by `SEQURAI_WORKSPACE_ROOT` at bridge startup (the folder you installed from).
- **Optional nested path**: clients may pass `workspacePath` only to select a subdirectory **inside** that authorized root — never to escape it.
- **Path traversal blocked**: `../`, encoded traversal, absolute paths outside the root, and symlink escapes are rejected with `workspace_path_not_authorized`.
- **`.sequraiignore`**: optional ignore file (gitignore-like syntax).
- **Default exclusions**: `node_modules`, `.git`, `.next`, `.env*`, keys, credentials.
- **Size limits**: 256 KB/file, 5 MB total, 200 files, depth 18 (aligned with GitHub scan limits).
- **Secret redaction**: evidence never includes full secrets.

Your API key lives in `.sequrai/mcp.env` (gitignored, mode 600).

## Local Production Verdict

`sequrai_local_audit` runs the **same canonical Production Verdict engine** used for GitHub scans:

1. Collect authorized workspace files (or git scope: workspace / working_tree / staged / diff)
2. Run the existing security scanner rules
3. Feed findings into `brain/production-verdict/engine.ts`
4. Return `verdictStatus`, `score`, blockers, findings, and narrative

If there is not enough evidence (empty workspace, no changed files in diff scope):

- `score = null`
- `verdictStatus = insufficient_data`

SequrAI does **not** fabricate a perfect score.

## Scopes

| Scope | Analyzes |
|-------|----------|
| `workspace` | All readable files in the workspace (default) |
| `working_tree` | Files with local git changes |
| `staged` | Staged diff only |
| `diff` | Unstaged diff only |

Example prompts:

- “Analyze my current workspace” → `sequrai_local_audit`
- “Review my changes before commit” → `sequrai_local_review` or `sequrai_local_audit` with scope
- “Can I push?” → local audit on `working_tree`, then remote `can_i_deploy` for GitHub truth

## Limitations

- Local analysis does **not** replace GitHub-connected dynamic testing.
- Local analysis does **not** upload arbitrary files unless you explicitly choose a remote operation.
- Claude Code HTTP-only setups need `source .sequrai/mcp.env`; local tools require the **stdio bridge**.

## Build/runtime bundle

Local analysis is bundled into `public/mcp/local-verdict-bundle.mjs` for the installed bridge:

```bash
npm run build:mcp-local
```

The installer verifies SHA-256 checksums from `public/mcp/install-manifest.json`.
