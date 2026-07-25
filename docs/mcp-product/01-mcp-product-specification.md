# MCP Product Specification

## What the MCP is

SequrAI in the IDE is an **Autonomous Production & Protection Engineer** — not an MCP server, not a scanner API, not ChatGPT with extra tools.

**User mental model:** “I’m talking to the engineer who protects my app.”  
**Not:** “I’m calling `can_i_deploy`.”

## Product promise (MCP surface)

| User need | MCP promise |
|-----------|-------------|
| Ship anxiety | Clear **yes / no / not yet** on deploy |
| Protection | Honest **comfort level** with production |
| Overwhelm | **Three worries max**, one next action |
| Fixes | **Safe Fix** as natural follow-up |
| Change | **What changed** without blame without evidence |

## Scope (Hybrid V1 — MCP sprint)

### In scope

- Natural-language coverage of 10 canonical questions (see doc 04).
- Opinionated, founder-language responses (doc 03, 06).
- Five-tool mapping only (doc 08).
- Onboarding narrative in Cursor (doc 05).
- Response design system (doc 06).
- Metrics (doc 09).

### Explicitly out of scope (no MCP exposure in this sprint)

- Continuous protection jobs, memory timeline APIs, alert feeds, monthly PDFs, auto-PR, behaviour rules as separate tools.
- Sixth tool (`am_i_protected`, `protect_project`, etc.) — **compose** from `can_i_deploy` + copy until bible amended.

## Architecture (conceptual, no new build)

```
User (Cursor/Claude Code)
    → Host model + MCP client
    → Tool selection (descriptions + server instructions)
    → SequrAI MCP HTTP (/api/mcp)
    → execute-tool (existing)
    → Verdict / scan / fix engines (unchanged)
    → buildTextResponse (formatting — primary change surface)
```

**Truth rule:** Deployment and protection answers come from **tool output**, never from the host model improvising.

## The five tools — product roles

| Tool | Product name (user-facing in responses) | Computes? |
|------|----------------------------------------|-----------|
| `review_now` | **Protection review** | Yes (async) |
| `can_i_deploy` | **Deploy answer** / protection comfort | No (read) |
| `safe_fix` | **Fix for Cursor** | No (prompt) |
| `what_changed` | **What changed** | No (diff) |
| `production_history` | **How you’ve been doing** | No (trend) |

## Composite intents (no new tools)

| User question | Tool sequence |
|---------------|---------------|
| Am I protected? | `can_i_deploy` (+ protection framing in response) |
| Protect my application | `review_now` → when done, `can_i_deploy` |
| Investigate this issue | `what_changed` optional → `review_now` |
| How healthy is my app? | `can_i_deploy` + `production_history` (short trend) |
| Would you deploy if it was your company? | `can_i_deploy` (same data, different lead sentence) |

## Bundled prompts (existing three)

| Prompt | Purpose |
|--------|---------|
| `prepare_for_deploy` | can_i_deploy → review_now → safe_fix |
| `review_latest_work` | review_now → can_i_deploy |
| `fix_top_blocker` | can_i_deploy → safe_fix |

Reframe descriptions in implementation to **protection language** — orchestration unchanged.

## Non-goals

- Exposing raw findings JSON, CVE lists, or scanner logs in MCP.
- Competing with Claude on general coding — SequrAI wins on **deploy/protection truth**.
- Enterprise MCP (team keys, audit export) — backlog.

## Success definition

Users prefer asking SequrAI over asking the base model for deploy/protection decisions — measured in doc 09.

## Relation to web app

Web: connect GitHub, billing, first deploy answer onboarding.  
MCP: daily habit — “Can I deploy?” before every ship.

Both must **sound like the same engineer** (shared personality doc 03).
