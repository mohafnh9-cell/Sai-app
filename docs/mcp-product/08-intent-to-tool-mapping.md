# Intent → Tool Mapping (Complete)

**Frozen tool surface:** `review_now` | `can_i_deploy` | `safe_fix` | `what_changed` | `production_history`

**Canonical mapping** (mirrors `server/mcp/intent-model.ts` `INTENT_TO_TOOL`):

| Intent ID | Tool |
|-----------|------|
| REVIEW_NOW | review_now |
| CAN_I_DEPLOY | can_i_deploy |
| SAFE_FIX | safe_fix |
| WHAT_CHANGED | what_changed |
| PRODUCTION_HISTORY | production_history |

---

## Master mapping table

| User intent / phrase family | Primary tool | Secondary | Notes |
|-----------------------------|--------------|-----------|-------|
| Can I deploy? | can_i_deploy | — | |
| Should I ship? | can_i_deploy | — | |
| Is it production ready? | can_i_deploy | — | |
| Would you launch this? | can_i_deploy | — | Opinion lead |
| Would you deploy if it was your company? | can_i_deploy | — | Same data |
| Am I protected? | can_i_deploy | — | Protection framing only |
| Show protection status | can_i_deploy | — | |
| What worries you? | can_i_deploy | — | Top 3 priorities |
| What's the biggest risk? | can_i_deploy | — | |
| What should I fix first? | can_i_deploy | safe_fix | Read worries then fix |
| Deployment confidence? | can_i_deploy | — | Footer score optional |
| Protect my application | review_now | can_i_deploy | After complete |
| Review my project / SaaS / app | review_now | — | |
| Review again | review_now | — | reason=after_fix |
| Scan / analyze / check latest | review_now | — | |
| Investigate (needs fresh data) | review_now | what_changed | Optional diff first |
| Run SequrAI | review_now | — | |
| Fix this problem | safe_fix | — | |
| Safe Fix | safe_fix | — | |
| How do I fix X? | safe_fix | — | Resolve blocker |
| Give me the Cursor prompt | safe_fix | — | |
| What changed? | what_changed | — | |
| Did I break anything? | what_changed | — | |
| Why did score drop? | what_changed | — | |
| Compare last two reviews | what_changed | — | |
| How healthy is my app? | production_history | can_i_deploy | Merge reply |
| Am I improving? | production_history | — | |
| Show history / trend | production_history | — | |
| Last 30 days | production_history | — | range param |
| Evolution / progress | production_history | — | |

---

## Product question → tool (mission list)

| # | Mission question | Tool(s) |
|---|------------------|---------|
| 1 | Can I deploy? | can_i_deploy |
| 2 | Am I protected? | can_i_deploy |
| 3 | What worries you? | can_i_deploy |
| 4 | What changed? | what_changed |
| 5 | What should I fix first? | can_i_deploy → safe_fix |
| 6 | How healthy is my application? | production_history + can_i_deploy |
| 7 | Would you deploy if it was your company? | can_i_deploy |
| 8 | Protect my application | review_now → can_i_deploy |
| 9 | Review my project | review_now |
| 10 | Review again | review_now |

---

## Bundled MCP prompts → sequences

| Prompt name | Sequence |
|-------------|----------|
| prepare_for_deploy | can_i_deploy → review_now → safe_fix |
| review_latest_work | review_now → can_i_deploy |
| fix_top_blocker | can_i_deploy → safe_fix |

---

## Tool → when NOT to use

| Tool | Do not use when |
|------|-----------------|
| can_i_deploy | User explicitly wants new scan; verdict missing and user wants review |
| review_now | User only asks readiness from existing verdict |
| safe_fix | Deploy decision only; no fix intent |
| what_changed | "Can I deploy right now?" |
| production_history | Current deploy gate without trend question |

---

## Host model decision tree (for instructions)

```
Deploy / protect / ready / worries / your company?
  → can_i_deploy (unless no verdict → review_now first)

Fresh analysis / protect / review / scan / investigate(new)?
  → review_now

Fix / prompt / how to solve?
  → safe_fix

Changed / broke / regressed?
  → what_changed

History / trend / healthy over time?
  → production_history (+ can_i_deploy if "healthy" includes now)
```

---

## Extending eval dataset (implementation follow-up)

Add rows to `MCP_INTENT_EVALUATION_DATASET` for:

- `am I protected` → can_i_deploy
- `what worries you` → can_i_deploy
- `protect my application` → review_now
- `would you deploy if it was your company` → can_i_deploy

Target counts per intent in existing test file conventions.

---

## Explicitly forbidden mappings

| User ask | Forbidden |
|----------|-----------|
| Any intent | Inventing sixth tool |
| Deploy question | Host-only answer without can_i_deploy |
| Fix | Host-generated fix without safe_fix |
| Protected | Separate backend feature in this sprint |

---

## Single source of truth

This table + doc 04 supersede informal routing.  
Tool descriptions (`tool-descriptions.ts`) and server instructions must stay **consistent** with this mapping when implementation runs.
