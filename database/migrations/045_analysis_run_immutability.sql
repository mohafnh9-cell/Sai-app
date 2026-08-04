-- Sprint 3: Analysis run immutability markers + feed/session scan scope
begin;

alter table public.scans
  add column if not exists immutability_locked_at timestamptz;

create index if not exists idx_scans_immutability_locked
  on public.scans (project_id, immutability_locked_at desc)
  where immutability_locked_at is not null;

alter table public.mission_control_feed_events
  add column if not exists scan_id uuid references public.scans(id) on delete set null;

alter table public.mission_control_sessions
  add column if not exists scan_id uuid references public.scans(id) on delete set null;

create index if not exists idx_mission_control_feed_project_scan
  on public.mission_control_feed_events (project_id, scan_id, occurred_at desc)
  where scan_id is not null;

create or replace function public.set_scan_immutability_lock()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('completed', 'failed', 'cancelled')
     and old.status is distinct from new.status
     and new.immutability_locked_at is null then
    new.immutability_locked_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_scans_immutability_lock on public.scans;

create trigger trg_scans_immutability_lock
  before update on public.scans
  for each row
  execute function public.set_scan_immutability_lock();

commit;
