# Auto Remediation Architecture (Hybrid V1)

**Product spec:** [../auto-remediation/README.md](../auto-remediation/README.md)

**Trust boundary:** GitHub **write** only inside approval-gated service.

---

## Components

```
┌─────────────────────────────────────────┐
│ Vercel API routes                        │
│  • safe_fix (sync — prompt generation)   │
│  • diff_preview (sync — bounded AI)      │
│  • approve_pr (writes after audit)       │
└─────────────────────────────────────────┘
        │
        ├── Fix engine (existing brain / prompt path)
        ├── Diff generator (scoped read GitHub + patch)
        └── GitHub App client (read default; write on PR path)
        ▼
Postgres: protection_recommendations + approval audit
        ▼
Memory: safe_fix_generated, fix_pr_opened, fix_verified
        ▼
Verify: review_now → scan-run (same as Layer 1)
```

---

## Sync vs async

| Operation | Mode | Why |
|-----------|------|-----|
| Safe Fix prompt | Sync MCP/API | User waiting; bounded tokens |
| Diff preview | Sync | Same |
| PR create | Async Inngest step | GitHub latency + retries |
| Verify review | Async scan job | Heavy |

MCP `safe_fix` stays sync; PR returns link to web or async notification.

---

## GitHub App scopes

| Mode | Scopes |
|------|--------|
| Prompt-only org | Contents read, metadata |
| PR enabled | Contents read/write, pull requests |

Requested at connect time — progressive scope upgrade.

---

## Idempotency

| Key | Prevents |
|-----|----------|
| fix_v1 | Duplicate recommendations |
| pr_v1 | Duplicate open PRs |
| operation_idempotency on approve endpoint | Double-click PR |

---

## Security

- Patch scanned for secret patterns before PR create.  
- Max files/lines enforced in diff service (product doc 02).  
- `approvedByUserId` required on PR path — DB constraint.

---

## Scale

| Tier | Note |
|------|------|
| 1k | Serial PR creates fine |
| 10k | Inngest queue `github-pr-create` with concurrency limit per installation |
| 50k | Same — GitHub App rate limits dominate; backoff + retry |

No separate Safe Fix worker fleet in V1 — Vercel functions + Inngest steps.

---

## Related

- [01-mcp-architecture.md](./01-mcp-architecture.md) — `safe_fix`  
- [04-event-architecture.md](./04-event-architecture.md)
