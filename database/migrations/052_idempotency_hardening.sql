-- Idempotency hardening: tenant-scoped webhook delivery IDs and active incremental scan uniqueness
begin;

-- Scope repository_events delivery IDs per organization (was globally unique).
alter table public.repository_events
  drop constraint if exists repository_events_github_delivery_id_key;

drop index if exists repository_events_github_delivery_id_key;

create unique index if not exists idx_repository_events_org_delivery
  on public.repository_events (organization_id, github_delivery_id)
  where github_delivery_id is not null;

-- Scope webhook ingress scan jobs per organization (was globally unique on delivery ID).
drop index if exists idx_scan_jobs_webhook_delivery;

create unique index if not exists idx_scan_jobs_webhook_delivery
  on public.scan_jobs (organization_id, github_delivery_id)
  where job_type = 'webhook_process'
    and github_delivery_id is not null;

-- One active incremental scan per repository commit SHA.
create unique index if not exists idx_scans_one_active_incremental_per_repository_sha
  on public.scans (repository_id, commit_sha)
  where scan_type = 'incremental'
    and commit_sha is not null
    and status in (
      'queued',
      'fetching_repository',
      'indexing',
      'scanning',
      'calculating_score'
    );

commit;
