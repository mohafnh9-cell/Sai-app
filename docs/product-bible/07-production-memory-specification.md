# Production Memory Specification

**Strategic role:** Primary moat—SequrAI knows the project’s protection story over time. Competitors can scan; they cannot easily replicate *your* history with *your* app.

**Expanded design (domains, timeline, UX, MCP contracts, scope):** [../production-memory/README.md](../production-memory/README.md).

---

## Principles

1. **Append-only** — Events are never mutated; corrections are new events.
2. **No secrets** — No tokens, env values, source code bodies, or raw webhook payloads.
3. **Project-scoped** — All memory keyed by `organizationId` + `projectId`.
4. **MCP-first read** — `production_history` and `what_changed` are thin views over memory.
5. **Retention** — Minimum 12 months for timeline and confidence series.

---

## Memory domains

### Project memory (core timeline)

Unified chronological stream of protection events.

**Event types (V1):**

| Type | Source |
|------|--------|
| `protection_review_started` | review_now / schedule |
| `protection_review_completed` | scan job |
| `verdict_created` | verdict engine |
| `deploy_readiness_checked` | can_i_deploy |
| `deploy_blocked` | can_i_deploy NO-GO |
| `deploy_ready` | can_i_deploy GO |
| `safe_fix_generated` | safe_fix |
| `fix_pr_opened` | GitHub PR flow |
| `fix_verified` | review after fix |
| `continuous_check_completed` | daily job |
| `material_change_detected` | daily/weekly |
| `alert_sent` | notifications |
| `confidence_snapshot` | scheduled |
| `attack_surface_snapshot` | scheduled |
| `dependency_snapshot` | scheduled |
| `protection_paused` / `protection_resumed` | user setting |

Each event: `id`, `projectId`, `organizationId`, `occurredAt`, `type`, `payload` (JSON, sanitized), optional `scanId`, optional `scanJobId`.

### Protection history

Filtered view: reviews + verdicts + CP checks + alerts.

### Deployment history

V1 sources:

- Manual: user ran `can_i_deploy` (GO/NO-GO).
- GitHub: push to default/production branch correlated with review outcome.
- Future: CI webhook (architecture only).

Stores: sha, branch, verdict at time, confidence scores.

### Recommendations history

Every Safe Fix and system recommendation with:

- `recommendationId`, title, severity, status (`open`, `applied`, `dismissed`, `verified`).

### Production confidence history

Time series: `{ date, productionConfidence, securityConfidence, healthLabel }`.

Daily snapshot minimum when CP ON.

### Security confidence history

Same series; separable for charts.

### Project health history

Composite health score time series for dashboard sparkline.

---

## Data model (logical)

```
protection_events (append-only)
protection_snapshots (daily rollup per project)
protection_recommendations
protection_deployments
```

Physical tables may merge or split in implementation; logical separation required.

**Indexes:** `(project_id, occurred_at desc)`, `(organization_id, occurred_at desc)`, `(type, occurred_at)`.

---

## MCP: `production_history`

Returns:

- Last 30/90 days narrative (configurable limit).
- Highlights: unsafe deploys prevented, fixes verified, confidence trend one-liner.
- Pointers to monthly reports.

---

## MCP: `what_changed`

Compares:

- Latest snapshot vs previous snapshot (or latest two reviews).

Returns:

- New/resolved findings (counts + top items).
- Confidence delta.
- Attack surface delta.
- Dependency delta summary.

---

## Monthly report data binding

| Report field | Memory source |
|--------------|---------------|
| Production Issues Prevented | count `deploy_blocked` + critical alerts acted on |
| Unsafe Deployments Prevented | count `deploy_blocked` |
| Critical Issues Addressed | count `fix_verified` with severity critical |
| Worries | latest verdict worries |
| Confidence | latest snapshot |

---

## Privacy & tenancy

- RLS: org members read own org events.
- Service role writes from workers.
- No cross-tenant aggregation in user-facing APIs.

---

## Future (architecture only)

- Founder-level memory across projects.
- Export API for due diligence.
- Embeddings for “similar worries in AI SaaS apps” (not V1).

---

## Success criteria

- 100% of completed reviews write at least one memory event.
- `what_changed` returns meaningful diff for ≥ 90% of projects with 2+ reviews.
- Memory powers monthly report with zero manual editing.
