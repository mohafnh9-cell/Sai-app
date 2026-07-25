# Safe Fix Specification

**Purpose:** The **default fix path** — copy-paste guidance for Cursor that turns “I would not deploy” into “here’s exactly what to change.”

**Position in pipeline:** **Recommend → Fix** (entry point for founders).

---

## What Safe Fix is

| Is | Is not |
|----|--------|
| Opinionated fix guidance in founder language | Generic ChatGPT security essay |
| Tied to a **specific** finding / blocker | Repo-wide refactor |
| Default **prompt-only** (no GitHub write) | Autonomous patch apply |
| Same worry as verdict + alerts | Separate scanner export |

---

## Modes (Hybrid V1)

| Mode | User action | GitHub scope | Default |
|------|-------------|--------------|---------|
| **Prompt-only** | Copy fix for Cursor | None | **Yes** |
| **Diff preview** | View patch in web/MCP | None | Optional |
| **PR generation** | Approve → open PR | Write (branch + PR) | Opt-in |

Escalation path: Prompt → diff preview → PR — never skip approval for PR.

---

## Safe Fix content structure

Every Safe Fix output includes:

```
FIX FOR CURSOR
────────────────
What we're fixing:
{one sentence — plain language}

Why it matters:
{user/business impact — one sentence}

Steps:
1. {concrete step}
2. {concrete step}
…

Files likely involved:
{paths only — no secret values}

After you apply:
Ask SequrAI to review again in Cursor.
```

**Banned in body:** raw CWE dumps, exploit recipes, real env values.

---

## Safe Fix confidence (0–100)

| Band | UX |
|------|-----|
| ≥ 70 | Show chip: *High confidence fix* |
| 50–69 | *Review carefully before merging* |
| &lt; 50 | *Get a second opinion — I'd verify with review again* |

Confidence affects copy, **not** auto-apply.

---

## Selection & priority

| Priority | Source |
|----------|--------|
| 1 | Deploy blocker (NO-GO primary) |
| 2 | Top worry on NOT YET |
| 3 | Open critical recommendation |
| 4 | Named finding in user message (`findingId`) |

MCP: `safe_fix` with `blockerId` / `priorityId` / `findingId` (implementation params — not new tools).

---

## Memory & recommendations

On generate:

- Event: `safe_fix_generated`  
- Row: `protection_recommendations` status `open`  

See [../production-memory/06-recommendations-history-specification.md](../production-memory/06-recommendations-history-specification.md).

---

## Unified UX naming (implementation sprint)

| Surface | Label |
|---------|--------|
| Primary button | **Copy fix for Cursor** |
| Success | **Copied — paste in Cursor** |
| MCP user-facing | *Fix this* / *Apply Safe Fix* in narrative |

See [../ux-sprint/03-safe-fix-redesign.md](../ux-sprint/03-safe-fix-redesign.md).

---

## Three-step micro-flow (UI)

1. **Copy fix for Cursor**  
2. **Paste & apply in your project**  
3. **Check again** → `review_now`  

Always visible when blockers exist on NO-GO / finale screens.

---

## Idempotency

Key: `{orgId}:{projectId}:{findingStableId}:fix_v1`

Same key within 24h → return same recommendation id, no duplicate Memory spam.

---

## Non-goals

- Auto-apply patch to main  
- Fix without linked finding (except generic worry → still creates recommendation)  
- Unlimited file scope (see diff doc 02)

---

## Acceptance criteria

- Every NO-GO with blockers offers Tier-1 Safe Fix card.  
- Prompt mode works with zero GitHub App write scope.  
- MCP `safe_fix` response matches web copy for same `recommendationId`.
