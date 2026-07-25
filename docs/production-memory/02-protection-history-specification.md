# Protection History Specification

**Definition:** A **filtered view** of Project Memory covering everything SequrAI did to **watch and review** the application — not deploy checks alone, not recommendations alone.

**Founder question answered:** *What has SequrAI done to protect my app?*

---

## Protection milestones

**Sparse, high-signal** rows in `protection_milestones` — not every event.

| milestone_type | Trigger | Founder line |
|----------------|---------|--------------|
| `first_protected` | First PROTECTED status | *SequrAI started protecting this app* |
| `streak_7` / `streak_30` | N daily checks CP ON | *30 days of daily protection* |
| `critical_fixed` | fix_verified critical | *Critical issue resolved: {title}* |
| `confidence_production_90` | production_confidence ≥ 90 first time | *Production confidence crossed 90%* |
| `unsafe_prevented_10` | deploy_blocked count ≥ 10 | *10 unsafe deploys prevented* |

MCP and 30-second timeline pull from milestones + profile counters.

---

## Confidence evolution (protection lens)

| Metric | Storage |
|--------|---------|
| Per review / daily | snapshots |
| Lifetime delta | profile |
| Week/month delta | weekly/monthly jobs |

**Unsafe deployments prevented:** Count `deploy_blocked` — shown in timeline headline, monthly report.

**Critical issues fixed:** Count `fix_verified` where severity critical.

**Protection improvements:** Status upgrades + attack surface down + material issues resolved.

---

## Included event types

| Type | Why it matters in protection story |
|------|-----------------------------------|
| `protection_review_started` | Shows initiative (MCP, you, or schedule) |
| `protection_review_completed` | Proof of work |
| `verdict_created` | Outcome of each review |
| `continuous_check_completed` | Daily peace of mind |
| `material_change_detected` | When watching caught something |
| `alert_sent` | When we reached out |
| `attack_surface_snapshot` | Exposure evolution |
| `dependency_snapshot` | Supply chain watch |
| `protection_status_updated` | PROTECTED → REQUIRES ATTENTION |
| `behaviour_signal` | Rule-based “something’s off” |
| `protection_paused` / `protection_resumed` | User trust boundary |

## Excluded (other domains)

| Type | Domain |
|------|--------|
| `deploy_*` | [Deployment History](./03-deployment-history-specification.md) |
| `safe_fix_*`, `recommendation_*`, `fix_*` | [Recommendations History](./06-recommendations-history-specification.md) |
| `confidence_snapshot` alone | Confidence / health histories (but **paired** with verdict in narrative) |

---

## Stored fields (per protection episode)

When presenting a **protection episode** (review or daily check with engine run):

| Field | Storage |
|-------|---------|
| Timestamp | `occurredAt` |
| Trigger | `mcp`, `web`, `daily`, `weekly`, `push` |
| Git SHA | Short hash only |
| Branch | Name |
| Deploy answer at time | GO / NO-GO / NOT YET |
| Production + security confidence | Numbers at verdict |
| Top worries (plain) | Max 3 strings |
| Attack surface level | LOW / MED / HIGH |
| Finding counts | By severity bucket — **not** full finding list in timeline |

---

## Query patterns

| Use case | Query |
|----------|-------|
| Last full review | Latest `verdict_created` |
| Last watch | Latest of `continuous_check_completed` or `protection_review_completed` |
| Protection last 30d | Events in set above, limit 50, narrative compress |
| “Did CP run this week?” | Count `continuous_check_completed` in 7d |

---

## Founder experience

**Protection Center — “Protection activity” (collapsed by default):**

```
Last 30 days
• Daily checks: 7/7 completed
• Full reviews: 2 (you triggered 1, schedule 1)
• Material changes: 1 — auth route added without middleware
```

**Not shown:** Job IDs, scan UUIDs, internal statuses.

---

## MCP

| Question | Tool | Protection history usage |
|----------|------|--------------------------|
| Are you still watching my app? | `can_i_deploy` | Last `continuous_check_completed` timestamp |
| When did you last review? | `production_history` | Latest `protection_review_completed` |
| What did you find last time? | `can_i_deploy` | Latest verdict worries |

---

## Weekly / monthly rollups

| Rollup | Protection history contribution |
|--------|--------------------------------|
| Weekly summary | Count checks, list material changes, reviews triggered |
| Monthly report | “Protection checks completed”, “Reviews run”, material changes narrative |

---

## Acceptance criteria

- Protection history API returns chronologically ordered episodes for UI timeline lite.
- Paused CP shows `protection_paused` in history with clear copy — not silent gap.
- MCP never returns raw event JSON to founders.
