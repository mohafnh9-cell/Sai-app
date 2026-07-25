# SHIPS NOW vs BACKLOG

**Authority:** [../product-bible/03-hybrid-v1-scope.md](../product-bible/03-hybrid-v1-scope.md) Layer 4.

---

## SHIPS NOW (Hybrid V1)

| Capability | Spec doc |
|------------|----------|
| Detect → explain via verdict worries | 07, bible 08 |
| Recommend priority + Safe Fix prompt | 01 |
| Copy fix for Cursor UX | 01, ux-sprint 03 |
| Safe Fix confidence display | 01 |
| Diff preview (scoped) | 02 |
| PR generation with **Approve and open PR** | 03, 04 |
| Approval audit (`approvedByUserId`, `approvedAt`) | 04 |
| Verification via `review_now` after_fix | 05 |
| `fix_verified` + Protect status update | 05 |
| Rollback detection + honest narrative | 06 |
| MCP `safe_fix` + verify suggest | 08 |
| Memory: safe_fix, fix_pr_opened, fix_verified, dismiss | production-memory 06 |
| Idempotency PR + fix keys | 01, 03 |
| No auto-merge / no prod patch | **All docs** |

### Acceptance (bible)

- ≥ 30% NO-GO → Safe Fix within 7 days  
- ≥ 50% opened PRs → verify within 14 days  
- Zero duplicate PRs per finding  
- Zero unapproved PRs  

---

## ARCHITECTURE ONLY

| Item | Notes |
|------|-------|
| CI deploy gate on NO-GO | Policy hook |
| MCP inline PR approval | Same audit trail required |
| Post-merge “please verify” webhook | Notification only |
| Ephemeral diff blob store | Scale |
| Stack-specific fix packs | Content |

---

## BACKLOG (explicit non-goals V1)

| Item | Why |
|------|-----|
| **Autonomous merge** without user | Violates mission |
| **Production hot-patch** | No prod changes |
| Auto-apply patch to main | Same |
| Silent GitHub push | Same |
| Fix without approval | Same |
| Multi-repo orchestration | Scope |
| Unlimited file / line diffs | Safety |
| Auto-rollback by SequrAI | User owns GitHub revert |
| “Auto-fix low severity” background bot | Requires opt-in bible amendment |
| Separate MCP tools (`open_pr`, `verify_fix`) | Tool cap frozen |
| Dependabot replacement | Not positioning |

---

## Implementation order (when code allowed)

1. Safe Fix prompt parity (web + MCP + Memory)  
2. Recommendation lifecycle  
3. Diff preview + scope limits  
4. Approval UI + audit  
5. GitHub PR creation + idempotency  
6. Verify after_fix + fix_verified rules  
7. Rollback detection on review  
8. Alert auto-resolve on verify  

---

## Governance

Any feature that **writes code or production** without explicit user approval in the same session → **BACKLOG** until bible doc 03 amended with acceptance criteria and trust review.

---

## North star

Founders say: *SequrAI helped me fix it — I was still in control.*

Not: *SequrAI changed my app while I slept.*
