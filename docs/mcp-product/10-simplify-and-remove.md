# MCP — Simplify and Remove

**Scope:** MCP-facing copy, instructions, responses, and docs — **not** backend features.

---

## Remove from user-facing MCP experience

| Item | Where | Why |
|------|-------|-----|
| “MCP server” / “MCP tool” | All user copy | Breaks immersion |
| “Production Ready Score” as headline | mcp.json canIDeploy | Use comfort language |
| “Production blockers” label | mcp.json | → “What worries me most” |
| “Verdict:” alone as opening | can_i_deploy formatter | → YES/NO sentence |
| “SHIP IT / DO NOT DEPLOY” alone | recommendationLabel | Fold into opinion line |
| “Call can_i_deploy to retrieve…” | reviewNow nextAction | User-facing host should merge |
| “Continuous Review” in user errors | mcp.json | → “Review in progress” (no CP product) |
| Theatrical mode names | continuous_review mode | Simplify |
| CVE / scanner IDs in default templates | formatters | Personality doc |
| Long timeline dumps | production_history formatter | Cap lines (doc 06) |
| Duplicate tool guidance in README vs instructions | docs | Single Cursor setup path |

---

## Simplify in tool descriptions (implementation)

| Current emphasis | Simplify to |
|------------------|-------------|
| “Production Review (scan)” | “Protection review” |
| “Persisted Production Verdict” | “Latest deploy & protection answer” |
| “Compute: YES/NO” metadata | Keep for **model** only — not in user text |
| Long example lists | Top 3 examples + “etc.” |

Keep ADR-001 five-tool list — shorten prose.

---

## Simplify server instructions

**Add:**

- Personality one-liner (senior engineer).
- Opinion-first formatting rule.
- Protection = comfort framing on `can_i_deploy`.

**Remove / shorten:**

- Redundant “Public tools (only these five)” repetition if descriptions already enforce.

---

## Simplify bundled prompts

| Prompt | Change |
|--------|--------|
| prepare_for_deploy | Rename description to “Before you ship” |
| review_latest_work | “After you code” |
| fix_top_blocker | “Fix what worries me most” |

No new prompts.

---

## Simplify errors (`mcp.json` errors.*)

| Key | Direction |
|-----|-----------|
| unauthorized | “Connection failed — check your SequrAI key in Cursor settings.” |
| no_verdict_available | “I haven't reviewed this app yet. Say ‘Protect my application.’” |
| ambiguous_project | List project **names** only, not IDs first |
| rate_limited | Friendly wait — no HTTP speak |

Remove internal error codes from user-visible text.

---

## Docs to archive or merge (founder path)

| Doc | Action |
|-----|--------|
| MCP_V1_IMPLEMENTATION.md | Internal / Advanced |
| MCP_V1_IMPLEMENTATION_REPORT.md | Archive |
| MCP_INTENT_EVALUATION_REPORT.md | Internal QA |
| MCP_V1_PRODUCTION_ENGINE.md | Internal |
| MCP_V1_SECURITY.md | Link from security policy — not onboarding |

**Keep public-simple:**

- MCP_CURSOR_SETUP.md — match doc 05 wizard verbatim
- MCP_CLAUDE_CODE_SETUP.md — parallel short path
- MCP_CLIENT_INSTRUCTIONS.md — merge into server instructions source of truth

---

## Remove from MCP JSON snippets (user-facing)

- stdio bridge as default path for founders — HTTP MCP primary in wizard
- Placeholder `/path/to/sequrai-app` without explanation
- `${workspaceFolder}` without defining it

Use one canonical snippet shape between Settings and onboarding wizard (UX sprint).

---

## Host model behaviours to forbid (via instructions)

- Answering “Can I deploy?” without tool when SequrAI connected
- Listing vulnerabilities before opinion
- Suggesting user read SonarQube / Snyk
- Multi-page responses

---

## Keep (do not simplify away)

- Five tool names in **machine** layer (API schema)
- `SEQURAI` header — brand anchor
- Stale verdict warnings — trust
- Safe Fix prompt body — full text required
- Idempotency / freshness rules in instructions — model-only
- Spanish locale support

---

## Implementation priority (when coding)

1. `can_i_deploy` response redesign (highest visibility)
2. `MCP_SERVER_INSTRUCTIONS` + tool description first lines
3. `safe_fix` closing CTA (“Review again”)
4. Error message pass
5. Mode label i18n
6. Docs consolidation

---

## Alignment check

Every removal must increase: **“I'm talking to my engineer”** not **“I'm using an integration.”**

If a string sounds like SonarQube → remove or rewrite per doc 03.
