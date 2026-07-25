# Auto Remediation Layer — Product Documentation

**Sprint scope:** Design only — **no implementation.**

**Mission:** SequrAI does not only detect problems — it helps **solve** them, with **mandatory user approval** at every step that changes code or production.

**Hard rule:** **NO autonomous production changes.** No auto-merge, no silent push, no hot-patch in prod.

## Pipeline

```
Detect → Explain → Recommend → Fix → Verify → Protect
```

| Stage | Layer 1 / CP | Auto remediation |
|-------|----------------|------------------|
| Detect | Reviews, verdict, findings | Same engines |
| Explain | Verdict worries | Founder-language impact |
| Recommend | Top worries | Safe Fix + priority |
| Fix | — | Prompt / diff / **approved** PR |
| Verify | — | `review_now` after_fix |
| Protect | Memory, status | `fix_verified`, alerts clear |

## Documents

| # | Deliverable | File |
|---|-------------|------|
| — | End-to-end pipeline | [00-pipeline-specification.md](./00-pipeline-specification.md) |
| 1 | Safe Fix | [01-safe-fix-specification.md](./01-safe-fix-specification.md) |
| 2 | Diff generation | [02-diff-generation-specification.md](./02-diff-generation-specification.md) |
| 3 | PR generation | [03-pr-generation-specification.md](./03-pr-generation-specification.md) |
| 4 | Approval workflows | [04-approval-workflows-specification.md](./04-approval-workflows-specification.md) |
| 5 | Verification workflows | [05-verification-workflows-specification.md](./05-verification-workflows-specification.md) |
| 6 | Rollback workflows | [06-rollback-workflows-specification.md](./06-rollback-workflows-specification.md) |
| 7 | Founder experience | [07-founder-experience-specification.md](./07-founder-experience-specification.md) |
| 8 | MCP experience | [08-mcp-auto-remediation-experience.md](./08-mcp-auto-remediation-experience.md) |
| 9 | Future architecture | [09-future-architecture-specification.md](./09-future-architecture-specification.md) |
| 10 | SHIPS NOW vs BACKLOG | [10-ships-now-vs-backlog.md](./10-ships-now-vs-backlog.md) |

**Bible summary:** [../product-bible/08-auto-remediation-specification.md](../product-bible/08-auto-remediation-specification.md)

## MCP (five tools)

| Stage | Tool |
|-------|------|
| Detect / explain / recommend | `can_i_deploy` |
| Fix | `safe_fix` |
| Verify | `review_now` (`after_fix`) |
| Protect / story | `can_i_deploy`, `what_changed`, `production_history` |

## Success criterion

≥ 30% of NO-GO founders use Safe Fix within 7 days; fixes followed by verify review; **zero** unapproved production changes attributed to SequrAI.
