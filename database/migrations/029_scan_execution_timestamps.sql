-- Scan execution lifecycle timestamps for queue → processing observability
begin;

alter table public.scans
  add column if not exists queued_at timestamptz,
  add column if not exists processing_started_at timestamptz;

update public.scans
set queued_at = coalesce(queued_at, created_at)
where queued_at is null;

commit;
