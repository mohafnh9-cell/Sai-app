# Analysis Runs (Sprint 1 — read path)

## Identity

An **Analysis Run** is scoped to a single repository analysis. Its identifier is `AnalysisRunId`, which maps 1:1 to `scans.id`.

Permanent project state (deploy pointer, repository metadata) lives on `projects` and `repository_scan_state`. Per-run artifacts live on `scans`, `scan_findings`, `production_verdicts` (1:1 scan), and `attack_simulation_campaigns` (1:1 scan).

## URL contract

When feature flag `analysis_run_isolation` is enabled for the organization:

```
/projects/{projectId}/mission-control?run={scanId}
/projects/{projectId}/attack-center?run={scanId}
```

- `run` must belong to the project and organization; invalid values redirect to the page without `run`.
- Missing `run` on Mission Control auto-redirects to the resolved active or latest completed run.
- Sub-navigation preserves `?run=` between Verdict and Validate tabs.

## Resolver (`resolveAnalysisRunForMissionControl`)

Resolution order:

1. **Query** — `?run=` if owned by project
2. **Active review** — scan from `getProductionReviewState` when in progress
3. **Latest completed** — most recent `scans.status = completed`
4. **Latest active** — most recent non-terminal scan status
5. **None** — no run (empty MC state)

## Read-path isolation (Sprint 1)

| Surface | Scoped behavior |
|---------|-----------------|
| Mission Control verdict | `getProductionVerdictByScan(runId)` — no fallback to current deploy verdict |
| Attack Center context | `getSecurityTestContext({ analysisRunId })` |
| Attack Center campaign | `getAttackCampaignByScanId(runId)` when scoped |
| Historical banner | Shown when viewing a run while a different review is active |

## Out of scope (later sprints)

- `POST /analysis-runs` dedicated endpoint (uses existing scans POST)
- DB immutability constraints
- Safe Fix scoping to run
- React Query cache keys per run
- MCP / deploy tools (keep `getCurrentProductionVerdict`)

## Write path (Sprint 2)

When the user clicks **Analyze again** (`context.hasVerdict`), the client sends `forceNew: true` on `POST /api/repositories/{id}/scans`.

| Policy | Behavior |
|--------|----------|
| Manual first review | Idempotency unchanged — may reuse completed scan for same commit |
| Manual analyze again | `forceNew: true` → always `create_new`, never `reuse_completed` |
| Active scan same commit | Still `resume_active` (one in-flight scan per repository) |
| Automatic / webhook reviews | Unchanged — may reuse completed scan |

After a new run starts from Mission Control, the client navigates to `?run={newScanId}` so the read path shows the in-progress analysis instead of a historical run.

## Immutability (Sprint 3)

| Layer | Behavior |
|-------|----------|
| `scans.immutability_locked_at` | Set by DB trigger when status → `completed`, `failed`, or `cancelled` |
| `production_verdicts` | Insert-only per `scan_id` — existing verdicts are never overwritten |
| MC feed | New events include `scan_id`; scoped reads filter by run |
| MC view / API | `getMissionControlView({ analysisRunId })` scopes feed, jobs, and verdict |

### Rollback

- Feature flag off → project-level MC view and legacy idempotency unchanged
- Migration 045 is additive (nullable columns + trigger); safe to deploy before code

## Feature flag

`analysis_run_isolation` — default rollout `"internal"`. When off, all pages behave as before (project-level latest verdict and campaign).
