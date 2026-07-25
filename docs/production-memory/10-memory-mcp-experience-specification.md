# Memory MCP Experience Specification

**Constraint:** **Five tools only.** Memory is never a sixth tool — it powers **`production_history`** and **`what_changed`** (and informs **`can_i_deploy`**, **`review_now`**, **`safe_fix`** writes).

---

## Mental model for hosts (Cursor / Claude)

SequrAI **remembers** the project. The user asks natural questions; the host routes to tools; formatters **query Memory** and speak in **founder language**.

**Never say:** “I'll query production_history.”  
**Say:** “Here's what changed since last week.”

---

## Tool ↔ memory map

| Tool | Read memory | Write memory |
|------|-------------|--------------|
| `production_history` | Snapshots, timeline episodes, deploy counts, verified fixes, weekly/monthly pointers | — |
| `what_changed` | Diff snapshot N vs N-1 (or last two verdicts) | — |
| `can_i_deploy` | Latest snapshot, last check, open recommendation summary | `deploy_*` events |
| `review_now` | Prior sha for context | Full review event chain |
| `safe_fix` | Open recommendations | `safe_fix_generated`, recommendation row |

---

## Intent routing (memory-heavy questions)

| User intent | Primary tool | Memory data used |
|-------------|--------------|------------------|
| How healthy is my app? | `production_history` | Health + confidence series |
| Am I improving? | `production_history` | 30d deltas |
| What changed? | `what_changed` | Snapshot diff |
| Since yesterday? | `what_changed` | 24h window filter |
| Why did confidence drop? | `what_changed` | Δ confidence + material reasons |
| Tell me our story | `production_history` | Top episodes |
| What should I fix first? | `can_i_deploy` | Open recommendations + worries |
| Did we fix X already? | `production_history` | Recommendations verified |
| How many times did you block deploy? | `production_history` | `deploy_blocked` count |
| Is my app becoming less secure? | `production_history` | Security confidence trend |
| Has anything changed since I last shipped? | `what_changed` | Push correlation + verdict |
| **What do you know about my application?** | `production_history` | Profile + tenure + stack + headline stats |
| **Has my project improved?** | `production_history` | Confidence deltas + fixes verified |
| **What changed this month?** | `what_changed` | `rangeDays=30` or monthly snapshot pair |
| **Am I more protected than last month?** | `production_history` + `can_i_deploy` | Status transition + tenure |
| **What worries you most?** | `can_i_deploy` | worriesTop3 (not history dump) |
| **How has my application evolved?** | `production_history` | Milestones + evolution paragraph |

Full table: [../mcp-product/08-intent-to-tool-mapping.md](../mcp-product/08-intent-to-tool-mapping.md).

---

## “What do you know about my application?” (canonical MCP story)

**Tool:** `production_history` (default 90d context, headline from profile all-time)

```
I've been protecting {Project} for {continuous_protection_days} days.

Stack I'm watching: {stack_fingerprint plain list}

What I know:
• {unsafe_prevented} times I would not have deployed
• {critical_fixed} critical fixes verified
• Production confidence {lifetime delta}; security {lifetime delta}
• Current status: {PROTECTED | …}

What worries me most today:
• {top worry or none}

What to do next:
• {one recommendation}
```

**Never** dump events. **Always** sound like the engineer who was there.

---

## `production_history` contract (design)

### Inputs (parameters)

| Param | Purpose |
|-------|---------|
| `rangeDays` | 7 / 30 / 90 (default 30) |
| `projectId` | Resolved from MCP auth context |

### Output structure (formatted text)

1. **Headline** — one sentence trend or story hook  
2. **Protection status now** — from latest snapshot (may duplicate `can_i_deploy` if bundled)  
3. **Confidence** — production + security with 7d direction  
4. **Highlights** — max 5 bullets (fixes verified, material changes, deploy blocks)  
5. **Next action** — one recommendation  
6. **Freshness** — last check timestamp  

### Must not output

- Raw JSON event array  
- CVE list  
- More than 5 history bullets without user asking for detail  

---

## `what_changed` contract (design)

### Compare strategy (V1)

1. Prefer **daily snapshots** if both exist within window.  
2. Else latest two **`verdict_created`**.  
3. If only one snapshot → honest “not enough history yet.”

### Output sections

```
What changed:
• {plain bullets max 5}

Confidence:
Production {a}% → {b}%
Security {c}% → {d}%

Protection impact:
{status stable | status now REQUIRES ATTENTION}

What I'd do:
{one action}
```

### Domains in diff

| Domain | Source events |
|--------|---------------|
| Findings | Counts + top plain titles |
| Attack surface | snapshot delta |
| Dependencies | dependency_snapshot |
| Behaviour | behaviour_signal summary |
| Status | protection_status_updated |

---

## Chaining (client instructions)

| Scenario | Sequence |
|----------|----------|
| Healthy + current worries | `production_history` then merge live `can_i_deploy` |
| Why drop + fix | `what_changed` → `safe_fix` |
| Stale verdict (&gt;7d) | Suggest `review_now` before strong historical claims |
| After `review_now` completes | Offer `what_changed` automatically |

---

## Voice examples

### Story

**User:** What has SequrAI done for this app?

**SequrAI (`production_history`):**

```
I've been protecting this project for six weeks.

• 42 daily checks completed
• 8 full reviews — 3 you triggered in Cursor
• 2 fixes verified (auth flow, env validation)
• 1 week we flagged a new public route before deploy

Production confidence is up 14 points over 30 days.
What I'd still fix: rate limiting on the API.

Last checked: today.
```

### Diff

**User:** Why did confidence drop?

**SequrAI (`what_changed`):**

```
Since your last review:
• New API route without auth middleware
• Production confidence 94% → 86%

This is what worries me most about the new route.

Recommended action: Apply Safe Fix, then review again.
```

---

## Freshness & honesty

| Condition | MCP behavior |
|-----------|--------------|
| CP paused | History OK; status NOT PROTECTED; no “watching daily” claim |
| Job delayed | “Last completed check was 2 days ago” |
| Single review | “Early days — I'll have richer history after a week of protection.” |

---

## Parity

Same `snapshotId` drives:

- Protection Center hero  
- `can_i_deploy` composite  
- History footer confidence integers  

---

## Eval & quality bar

Add intent eval rows:

- `tell me the story of this app` → production_history  
- `why did confidence drop` → what_changed  
- `what did we fix last month` → production_history  

**Success:** Founder prefers SequrAI over generic LLM for **project-specific** history questions because Memory grounds answers.

---

## Acceptance criteria

- `production_history` never returns empty for projects with ≥ 7 daily snapshots — minimum narrative template.  
- `what_changed` returns explicit “insufficient history” for single-review projects — not hallucinated diffs.  
- All memory reads respect org RLS in implementation (design requirement in doc 11).
