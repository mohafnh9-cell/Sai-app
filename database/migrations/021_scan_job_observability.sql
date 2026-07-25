-- Phase 1.5: operational observability, recovery metadata, idempotency keys
begin;

alter table public.scan_jobs
  add column if not exists heartbeat_at timestamptz,
  add column if not exists execution_deadline_at timestamptz,
  add column if not exists last_recovery_at timestamptz,
  add column if not exists recovery_attempts integer not null default 0,
  add column if not exists max_recovery_attempts integer not null default 3,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists queue_wait_ms integer,
  add column if not exists duration_ms integer;

create index if not exists idx_scan_jobs_stuck_recovery
  on public.scan_jobs (status, execution_deadline_at, updated_at)
  where status in ('queued', 'running');

create table if not exists public.scan_job_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  scan_job_id uuid references public.scan_jobs(id) on delete set null,
  scan_id uuid references public.scans(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  job_type text,
  attempt integer,
  duration_ms integer,
  queue_wait_ms integer,
  failure_code text,
  provider text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_scan_job_events_type_created
  on public.scan_job_events (event_type, created_at desc);

create index if not exists idx_scan_job_events_org_created
  on public.scan_job_events (organization_id, created_at desc)
  where organization_id is not null;

create index if not exists idx_scan_job_events_job_created
  on public.scan_job_events (scan_job_id, created_at desc)
  where scan_job_id is not null;

create table if not exists public.operation_idempotency (
  idempotency_key text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  scan_id uuid references public.scans(id) on delete set null,
  operation_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_operation_idempotency_org_type
  on public.operation_idempotency (organization_id, operation_type, created_at desc);

alter table public.scan_job_events enable row level security;
alter table public.operation_idempotency enable row level security;

drop policy if exists "Members read scan job events" on public.scan_job_events;
create policy "Members read scan job events" on public.scan_job_events for select using (
  organization_id is null or exists (
    select 1 from public.organization_members m
    where m.organization_id = scan_job_events.organization_id and m.user_id = auth.uid()
  )
);

drop policy if exists "Members read operation idempotency" on public.operation_idempotency;
create policy "Members read operation idempotency" on public.operation_idempotency for select using (
  exists (
    select 1 from public.organization_members m
    where m.organization_id = operation_idempotency.organization_id and m.user_id = auth.uid()
  )
);

commit;
