# MCP Auto Remediation Experience Specification

**Constraint:** Five tools — **`safe_fix`**, **`review_now`**, **`can_i_deploy`**, **`what_changed`**, **`production_history`**. No fix PR tool.

---

## Pipeline mapping

| Stage | MCP tool | User phrases |
|-------|----------|--------------|
| Detect | — | (via prior review) |
| Explain | `can_i_deploy` | *What worries you?* *Why not deploy?* |
| Recommend | `can_i_deploy` → `safe_fix` | *What should I fix first?* |
| Fix | `safe_fix` | *Fix this*, *Safe Fix*, *how do I fix X* |
| Verify | `review_now` | *Review again*, *check my fix* |
| Protect | `can_i_deploy` | *Am I protected?* *Can I deploy now?* |

---

## `safe_fix` response (design)

Follow [../mcp-product/06-mcp-response-design-system.md](../mcp-product/06-mcp-response-design-system.md):

```
FIX FOR CURSOR

{prompt body — paste-ready}

After you apply this, ask me to review again.
```

Optional footer:

- Fix confidence chip  
- *Open diff / PR on web:* `{deep link}` — when PR path enabled  

**Never** auto-run `review_now` without user ask.

---

## Compound flows (client instructions)

| Bundled prompt | Sequence |
|----------------|----------|
| `fix_top_blocker` | `can_i_deploy` → `safe_fix` |
| `prepare_for_deploy` | `can_i_deploy` → `review_now` → `safe_fix` |
| After every `safe_fix` | Suggest: *“Say review again when done.”* |

---

## Explain without fix

User: *Why is this a problem?*

→ `can_i_deploy` worries + one-sentence impact — **not** `safe_fix` unless they ask how to fix.

---

## Verify narrative

User: *Review again* / *I applied the fix*

→ `review_now` (`after_fix`)

Then optional auto-follow-up in host:

→ `can_i_deploy` for Protect summary in same turn if host bundles.

Example:

```
Review complete.

That fix worked — I'm no longer worried about {x}.
Deploy answer: GO
Production confidence: 91%

You're protected again for this issue.
```

---

## PR from MCP

V1 default:

> *I can show the patch in the app — say "open Protection Center" or use this link to approve a PR.*

No silent OAuth PR creation in MCP unless future architecture (doc 09) with same approval audit.

---

## `what_changed` after fix

User: *Did my fix change anything?*

→ `what_changed` comparing pre/post verify snapshots — confidence delta + cleared finding.

---

## `production_history`

User: *What fixes did we apply?*

→ Verified recommendations list from Memory — ties to reports doc 05.

---

## Voice rules

- Opinionated: *I'd fix this before deploy*  
- No: *Here are 47 steps* without prioritization  
- No autonomous language: *I'll merge*, *I've deployed*

---

## Eval intents

- `fix this problem` → safe_fix  
- `review again after fix` → review_now  
- `did the fix work` → review_now or can_i_deploy after  

---

## Acceptance criteria

- MCP fix text matches web for same recommendationId.  
- Every successful verify suggests Protect check without forcing second tool call.  
- No sixth tool in manifest.
