# MCP Continuous Protection Experience

**Constraint:** **Five tools only** — continuous protection is **data + voice**, not new MCP surface.

| Tool | Continuous protection role |
|------|----------------------------|
| `review_now` | Refresh protection after changes; “protect my application” |
| `can_i_deploy` | **Am I protected?** deploy gate + status + worries |
| `safe_fix` | Fix what CP recommends |
| `what_changed` | Since yesterday / since last review / week delta |
| `production_history` | Health trends, confidence direction, weekly narrative |

Full intent table: [../mcp-product/08-intent-to-tool-mapping.md](../mcp-product/08-intent-to-tool-mapping.md).

---

## Philosophy

The user never thinks “daily job ran.” They think:

> *My Production Engineer knows the state of my app.*

MCP answers must reference **freshness** (“last checked …”) and **protection status** (doc 04) without mentioning cron, Inngest, or Memory.

---

## Continuous protection question map

| Founder question | Tool(s) | Response emphasis |
|------------------|---------|-------------------|
| Am I protected? | `can_i_deploy` | Status headline first |
| Is my application healthy? | `production_history` + `can_i_deploy` | Health label + trend |
| What changed? | `what_changed` | Plain diff, max 5 bullets |
| What worries you? | `can_i_deploy` | Top 3 worries |
| Should I deploy today? | `can_i_deploy` | YES / NO / NOT YET opinion |
| Has anything changed since yesterday? | `what_changed` | 24h window narrative |
| Is my app becoming less secure? | `production_history` | 7d/30d confidence direction + cause if known |
| What should I fix first? | `can_i_deploy` → `safe_fix` | One recommendation |
| Protect my application | `review_now` | Then optional status via `can_i_deploy` |
| Review again | `review_now` | reason `after_fix` or `scheduled_user` |

---

## Response templates (continuous protection voice)

Align with [../mcp-product/06-mcp-response-design-system.md](../mcp-product/06-mcp-response-design-system.md).

### Am I protected? (PROTECTED)

```
Yes — I'm protecting this application.

Your application is: PROTECTED
Last checked: {relative}

Things that worry me:
• {none | one mild item}

You can deploy when you're ready — I'd still fix {x} before traffic spikes.
Deployment confidence: {n}%
```

### Am I protected? (SAFE WITH CAUTION)

```
You're protected, but I'm not fully comfortable yet.

Your application is: SAFE WITH CAUTION

What worries me most:
• {worry 1}
• {worry 2}

Recommended action:
Apply Safe Fix before your next deployment.
```

### Is my application healthy?

```
Production health: {Excellent|Good|Needs attention|At risk}

Production confidence: {n}% ({↑|↓|→} over 7 days)
Security confidence: {n}% ({↑|↓|→} over 7 days)

What worries me:
• {max 3}

Next step:
{one action}
```

### What changed since yesterday?

Use `what_changed`:

```
Since yesterday:
• {change 1}
• {change 2}

Protection impact:
{one sentence — status stable | now REQUIRES ATTENTION}
```

---

## When to chain tools (host / client instructions)

| Situation | Sequence |
|-----------|----------|
| User asks protect + status | `review_now` → on complete → `can_i_deploy` |
| User asks healthy + worries | `production_history` → merge with latest `can_i_deploy` data in one reply |
| Verdict stale (&gt; 7d) while CP ON | Lead with `review_now` offer before strong PROTECTED claim |
| CP paused | `can_i_deploy` only — explain NOT PROTECTED; do not run hidden scan |

---

## What MCP must not do

- Claim “real-time monitoring” or live attack blocking
- Dump CVE tables or CVSS
- Expose internal job names
- Add sixth tool for “run daily check”

Scheduled work stays **backend**; MCP **reads** results.

---

## Parity with Protection Center

| Field | Single source (future impl) |
|-------|----------------------------|
| protectionStatus | Verdict + CP state machine doc 04 |
| worriesTop3 | Verdict narrative |
| recommendation | Recommendation engine |
| lastCheckedAt | Latest continuous_check_completed |
| confidence | Latest snapshot |

MCP and web must not diverge on the same timestamp.

---

## Success metrics (MCP + CP)

| Signal | Target |
|--------|--------|
| “Am I protected?” answered without user knowing tool name | Qual + intent eval |
| Users prefer SequrAI over generic model for status | Interview |
| Compound intents routed correctly | MCP eval dataset rows for CP phrases |

Add eval rows (implementation follow-up):

- `is my app becoming less secure` → production_history
- `should I deploy today` → can_i_deploy
- `what changed since yesterday` → what_changed

---

## Conversation example

**Founder:** Should I deploy today?

**SequrAI (can_i_deploy):**

```
NOT YET.

I wouldn't deploy today — missing rate limiting on your auth routes worries me most.

Recommended action:
Apply Safe Fix, then ask me to review again.

Deployment confidence: 73%
Your application is: SAFE WITH CAUTION
```

**Founder:** What changed since yesterday?

**SequrAI (what_changed):**

```
Since yesterday:
• New public API route without auth middleware.
• Production confidence down 8 points.

Your status is still SAFE WITH CAUTION, but I'd fix the new route before deploy.
```
