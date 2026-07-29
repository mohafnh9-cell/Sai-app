# GitHub → Production Review synchronization (final report)

## 1. Migration audit

| Migration | Purpose | Dependencies | Idempotency |
|-----------|---------|--------------|-------------|
| `020_scan_jobs.sql` | `scan_jobs` table, FKs to org/project/scan, status/job_type checks, RLS read policy | `organizations`, `projects`, `scans` | `create table if not exists`, `create index if not exists` |
| `021_scan_job_observability.sql` | Heartbeat, locking, recovery columns; `scan_job_events`; `operation_idempotency` | `020` | `add column if not exists`, `create table if not exists` |
| `041_review_cancellation.sql` | Scan cancellation columns; expanded `scans_status_check`; one active full scan per repo | `scans` | `add column if not exists`, drop/recreate constraint/index |

**Rollback:** Dropping `scan_jobs` removes events and job history; scan rows and verdicts remain. Not recommended on production.

**RLS:** `scan_jobs` is readable by org members; workers use service role.

## 2. Manual SQL execution order

1. `database/migrations/020_scan_jobs.sql`
2. `database/migrations/021_scan_job_observability.sql`
3. `database/migrations/041_review_cancellation.sql`

Preflight: `scripts/supabase-scan-jobs-preflight.sql`  
Diagnostics: `scripts/supabase-production-review-diagnostics.sql` (replace `:project_id`)

## 3. Production fallback policy

- **Production:** Every full Production Review **must** create a `scan_jobs` row. Silent `legacy-inline-scan-run` is **disabled**.
- **Opt-in emergency:** `ALLOW_LEGACY_INLINE_SCAN_FALLBACK=1`
- **Development / tests:** Legacy fallback allowed when `NODE_ENV !== 'production'`.
- **Error:** `SCAN_JOB_INFRASTRUCTURE_MISSING` with `migrationRequired: true` and structured log `scan_job_infrastructure_missing`.

## 4. Scan entrypoints audited

| Path | HEAD / SHA | `scans.commit_sha` | `scan_jobs` | `headCommitSha` |
|------|------------|-------------------|-------------|-----------------|
| `app/api/repositories/[repositoryId]/scans/route.ts` | `resolveLatestReviewCommit` | Yes | `scheduleScanRun` | Yes |
| `server/review-now/trigger-review.ts` | resolve / explicit | Yes | `scheduleScanRun` | Yes |
| GitHub webhook automation | webhook SHA | Yes | `scheduleAutomationScan` | Yes |
| MCP `review_now` | via `triggerProductionReview` | Yes | Yes | Yes |
| Retries / recovery | pinned from scan row | Existing | Job store | From payload |

## 5. Commit pinning

- Model: `lib/production-review/commit-target.ts` (`ProductionReviewCommitTarget`)
- Runner: `fetchSnapshot({ branch, commitSha: headCommitSha })` in `scan-job-runner.ts`
- Mismatch → `COMMIT_SNAPSHOT_MISMATCH` (GitHubServiceError); metrics: `requestedCommitSha`, `resolvedSnapshotSha`, `analyzedCommitSha`
- Discovery: `loadDiscoveryRepositoryFromProject` resolves HEAD once if `commitSha` omitted

## 6. Supersede behavior

- `releaseActiveReviewForNewHead` marks older active scans `failed` with `COMMIT_SUPERSEDED_BY_REMOTE_HEAD`, cancels active jobs, clears `repository_scan_state`
- Metrics: `supersededAt`, `supersededByCommitSha`, optional `supersededByScanId`
- UI hides superseded failure banners; state treats superseded as idle

## 7. UI state contract

`GET /api/projects/[id]/production-review-state` returns `contract`:

- `github`, `latestCompletedReview`, `activeReview`, `repositoryOutOfSync`, `reviewInProgress`, `canStartReview`, `canCancelReview`

`reviewInProgress` requires a real `scan_jobs` row in `queued` or `running`.

## 8. MCP / discovery

- `loadDiscoveryRepositoryFromProject` accepts optional `commitSha`; otherwise resolves live GitHub HEAD once and fetches by SHA.

## 9. Files changed (this initiative)

- `server/jobs/scan-job-infrastructure.ts`
- `server/jobs/schedule-scan.ts`
- `server/security-scanner/scan-job-runner.ts`
- `server/review-cancel/get-production-review-state.ts`
- `server/projects/build-production-review-ui-contract.ts`
- `app/api/projects/[id]/production-review-state/route.ts`
- `app/api/repositories/[repositoryId]/scans/route.ts`
- `features/projects/components/AnalyzeProjectButton.tsx`
- `server/ai-red-team/discovery/sources/load-project-repository.ts`
- `server/review-start/release-active-review-for-new-head.ts`
- `lib/production-review/commit-target.ts`
- `scripts/supabase-scan-jobs-preflight.sql`
- `scripts/supabase-production-review-diagnostics.sql`
- `messages/en/projects.json`, `messages/es/projects.json`
- Tests under `server/jobs/__tests__/scan-job-infrastructure.test.ts`

## 10. Tests

Run:

```bash
npm test -- server/jobs/__tests__/scan-job-infrastructure.test.ts
npm test -- server/review-now/__tests__/trigger-review.test.ts
npm test -- lib/repository-sync/__tests__/compute-sync-display.test.ts
```

## 11. Manual acceptance checklist (Phase 14)

See user spec steps 1–10: push → verify SHAs → start review → verify `scan` + `scan_jobs` → complete → verify verdict SHA → push during active → supersede.

## 12. Remaining blockers

- **Production Supabase** must show `scan_jobs_exists = true` in preflight after migrations.
- **Vercel** must not set `ALLOW_LEGACY_INLINE_SCAN_FALLBACK=1` in production unless emergency.
- Historical scans with `commit_sha IS NULL` may still appear in diagnostics until backfilled or superseded.
