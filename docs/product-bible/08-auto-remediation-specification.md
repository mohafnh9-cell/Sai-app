# Auto Remediation Specification

**Goal:** SequrAI does not only detect—it helps fix, verify, and restore protection—with **human approval** in Hybrid V1.

**Complete layer design (Safe Fix, diff, PR, approval, verify, rollback, MCP, scope):** [../auto-remediation/README.md](../auto-remediation/README.md).

---

## Pipeline

```
Detect
  ↓
Explain        (founder language, business impact)
  ↓
Recommend      (Safe Fix, priority order)
  ↓
Fix            (prompt, diff, PR — user approved)
  ↓
Verify         (review again)
  ↓
Protect        (updated verdict + memory + optional alert clear)
```

---

## Detect

- Sources: Layer 1 reviews, continuous checks, dependency advisories.
- Output: finding with severity, domain, evidence references (file/line), no secret values.

---

## Explain

Every finding includes:

- **What this is** (one sentence).
- **Why it matters to your users/business.**
- **What SequrAI recommends** (single path).

Banned: raw CWE lists without translation.

---

## Recommend

- Rank by deploy blockers first.
- Tie to Production Verdict “worries.”
- MCP: `safe_fix` with `blockerId` / `priorityId` / `findingId`.

---

## Safe Fix (V1)

| Mode | Description |
|------|-------------|
| Prompt-only | Copy into Cursor—default, zero GitHub scope |
| Diff preview | Unified diff in web/MCP response—no apply |
| PR generation | GitHub PR from patch—requires approval |

**Safe Fix confidence:** 0–100; show when &lt; 70 “review carefully.”

---

## Diff generation

- Generated from fix engine (existing brain/fix-prompt path).
- Max file scope per fix (prevent repo-wide AI rewrites).
- Idempotency key: `org:project:scan:finding:fix_v1`.

---

## PR generation

**Flow:**

1. User requests fix in MCP or clicks “Open fix PR” on web.
2. SequrAI shows summary + diff preview.
3. User clicks **Approve and open PR**.
4. GitHub PR created with standard title prefix `[SequrAI Safe Fix]`.
5. Memory event `fix_pr_opened`.

**Never:** auto-merge, auto-deploy, silent push to main.

---

## Approval flows

| Action | Approval |
|--------|----------|
| View Safe Fix prompt | None |
| Copy prompt | None |
| Open PR | Explicit click + confirm dialog |
| Dismiss recommendation | Optional reason (memory) |

Audit: store `approvedByUserId`, `approvedAt` on PR events.

---

## Verification

After PR merge or local fix:

1. User: “Review again” / MCP `review_now` with `after_fix`.
2. System compares verdict to pre-fix snapshot.
3. Memory: `fix_verified` if blocker cleared.
4. MCP response: “You’re protected again” or remaining worries.

---

## Rollbacks

- User reverts PR in GitHub → next review detects regression.
- Memory: `fix_reverted` (optional manual or detected via sha).
- No automatic revert by SequrAI in V1.

---

## Failure handling

| Failure | Behaviour |
|---------|-----------|
| PR creation failed | Retry once; alert user; no duplicate PRs (idempotency) |
| Fix didn’t clear finding | Honest NO-GO; suggest human review |
| AI fix low quality | Confidence score + “get a second opinion” copy |

---

## MCP integration

- “Fix this problem” → `safe_fix`.
- Compound: after fix instructions, suggest “Review again when done.”
- PR path: deep link to web approval if MCP cannot host OAuth.

---

## Non-goals (V1)

- Autonomous merge without user.
- Production hot-patch.
- Multi-file mega-refactors without scope limits.

---

## Success criteria

- ≥ 30% of NO-GO users invoke Safe Fix within 7 days.
- ≥ 50% of opened PRs followed by verify review within 14 days.
- Zero duplicate PRs for same finding (idempotency tests).
