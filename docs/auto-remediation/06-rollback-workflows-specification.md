# Rollback Workflows Specification

**Purpose:** When a fix **doesn't work** or the user **reverts** — SequrAI stays honest and Memory stays accurate.

**Rule:** SequrAI **never** auto-reverts GitHub or production in V1.

---

## Rollback scenarios

| Scenario | Detection | SequrAI action |
|----------|-----------|----------------|
| User closes PR without merge | GitHub webhook / poll | Recommendation → `open` or `dismissed`; no verify |
| User merges then reverts commit | New SHA + review shows finding back | Memory `fix_reverted` or new verdict |
| User reverts in GitHub UI | Same | Explain on next `review_now` |
| Bad fix merged, new critical | Review | Honest NO-GO; new Safe Fix |
| User undo locally | Next review | Same as revert |

---

## Memory events

| Event | When |
|-------|------|
| `fix_reverted` | System detects regression tied to prior `fix_verified` recommendation |
| `verdict_created` | Post-revert review |
| `protection_status_updated` | Status worsens |

Payload: `{ recommendationId, previousSha, currentSha, summaryPlain }` — no diff bodies.

---

## User-initiated rollback guidance (copy)

When user says *“I reverted the fix”* in MCP:

```
Got it — I'll treat that as undone.

What worries me again:
• {finding}

What to do next:
{safe_fix OR manual path}
Run review again after your next attempt.
```

Tool: `can_i_deploy` or `review_now` — not a rollback tool.

---

## Web UX

Protection Center → Past fixes:

| Status | Label |
|--------|--------|
| verified | Fixed |
| reverted | *Reverted — needs attention again* |

Optional action: *Generate new Safe Fix* — same finding, new idempotency epoch after new scan.

---

## Relationship to Verify

Verification **confirms forward progress**; rollback **records backward movement**.

Timeline shows both:

```
Mar 10 — Fix verified: rate limiting
Mar 14 — Change reverted — worry returned
```

---

## PR rollback specifically

SequrAI does **not** click “Revert” on GitHub.

User flow:

1. Revert in GitHub  
2. *Review again* in Cursor  
3. SequrAI updates status honestly  

---

## Alerts

Regression after verify may trigger **material change** alert (AT-07 / new critical) — idempotent.

Not a blame alert:

> *Something changed — we're back to worrying about {x}.*

---

## Acceptance criteria

- Revert detection updates recommendation state within next successful review.  
- No automated git push from SequrAI on rollback path.  
- MCP never claims protected after reverted finding present.
