-- Production review user cancellation metadata and intermediate status
begin;

alter table public.scans
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancellation_reason text,
  add column if not exists progress_at_cancellation smallint
    check (progress_at_cancellation is null or progress_at_cancellation between 0 and 100),
  add column if not exists last_completed_phase text;

alter table public.scans drop constraint if exists scans_status_check;

alter table public.scans
  add constraint scans_status_check
  check (status in (
    'queued', 'fetching_repository', 'indexing', 'scanning',
    'calculating_score', 'cancelling', 'completed', 'failed', 'cancelled'
  ));

drop index if exists public.idx_scans_one_active_full_per_repository;

create unique index idx_scans_one_active_full_per_repository
  on public.scans (repository_id)
  where scan_type = 'full'
    and status in (
      'queued', 'fetching_repository', 'indexing', 'scanning',
      'calculating_score', 'cancelling'
    );

commit;
