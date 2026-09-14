-- Phase 35.5: the SecurityJob domain -- the queue between Vercel/MCP
-- (job creation, billing-gated) and the standalone Security Execution
-- Worker (job execution, outside Vercel). Additive only; does not touch
-- scans, scan_jobs, external_engine_findings, engine_executions,
-- finding_correlations, or attack_chains (migrations 002/004/061/062).
--
-- Design note (see worker README): the worker POLLS this table for QUEUED
-- rows rather than Vercel pushing jobs to a worker HTTP endpoint. This
-- avoids exposing any inbound network endpoint on the worker at all --
-- there is no "submit arbitrary job" surface to defend, only a
-- service-role-authenticated read/claim against a table RLS already
-- protects. See Phase 35.5 final report section "Worker Architecture" for
-- the full push-vs-pull justification.

create table if not exists public.security_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,

  engine text not null check (engine in ('opengrep', 'trivy', 'crypto', 'scorecard')),
  engine_version text not null,
  capabilities jsonb not null default '[]'::jsonb,

  -- Server-generated, never client-supplied (section 29/54): the row that
  -- proves this job passed authorization/billing before being queued.
  requested_by uuid references auth.users(id) on delete set null,
  request_id text,

  status text not null default 'QUEUED' check (
    status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'REJECTED')
  ),
  cancel_requested boolean not null default false,

  priority smallint not null default 0,
  attempt smallint not null default 0,
  max_attempts smallint not null default 3,

  timeout_ms integer not null default 600000,
  resource_limits jsonb not null default '{}'::jsonb,
  network_policy text not null default 'NONE' check (
    network_policy in ('NONE', 'REGISTRY_ONLY', 'TARGET_ONLY', 'CONTROL_PLANE_ONLY', 'AUTHORIZED_EXTERNAL')
  ),

  -- Idempotency key: (scan_id, engine) is unique among non-terminal rows --
  -- a duplicate MCP/API retry re-queuing the same (scan, engine) pair hits
  -- this constraint instead of creating a second job (section 37).
  idempotency_key text not null,

  -- Claim fencing: set by the worker that successfully claims this row via
  -- the atomic claim function below; prevents two worker processes from
  -- both executing the same job.
  claimed_by text,
  claimed_at timestamptz,

  error jsonb,

  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'security_jobs_tenant_fk'
      and conrelid = 'public.security_jobs'::regclass
  ) then
    alter table public.security_jobs
      add constraint security_jobs_tenant_fk
      foreign key (project_id, organization_id)
      references public.projects (id, organization_id)
      on delete cascade;
  end if;
end
$$;

-- Idempotency: only one non-terminal job per (scan, engine). A finished
-- (COMPLETED/FAILED/CANCELLED/TIMED_OUT/REJECTED) row does not block a
-- fresh retry of that scan.
create unique index if not exists idx_security_jobs_idempotency_active
  on public.security_jobs (scan_id, engine)
  where status in ('QUEUED', 'RUNNING');

create index if not exists idx_security_jobs_claim_queue
  on public.security_jobs (status, priority desc, requested_at)
  where status = 'QUEUED';
create index if not exists idx_security_jobs_scan
  on public.security_jobs (scan_id);
create index if not exists idx_security_jobs_project_org
  on public.security_jobs (project_id, organization_id, requested_at desc);

alter table public.security_jobs enable row level security;

drop policy if exists "Members read security jobs" on public.security_jobs;
create policy "Members read security jobs"
  on public.security_jobs for select
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = security_jobs.organization_id
        and m.user_id = auth.uid()
    )
  );

drop trigger if exists set_security_jobs_updated_at on public.security_jobs;
create trigger set_security_jobs_updated_at
  before update on public.security_jobs
  for each row execute function public.set_updated_at();

-- Atomic claim: SKIP LOCKED so two concurrent worker processes never claim
-- the same row (section 5/37 -- "a job must not execute twice"). Returns
-- the claimed row, or no row if nothing is queued.
create or replace function public.claim_next_security_job(p_worker_id text)
returns setof public.security_jobs
language plpgsql
as $$
begin
  return query
  update public.security_jobs
  set status = 'RUNNING',
      claimed_by = p_worker_id,
      claimed_at = now(),
      started_at = now(),
      attempt = attempt + 1,
      updated_at = now()
  where id = (
    select id from public.security_jobs
    where status = 'QUEUED'
    order by priority desc, requested_at asc
    limit 1
    for update skip locked
  )
  returning *;
end;
$$;

-- Structured lifecycle events (section 27) -- real stages only, never a
-- fabricated progress percentage.
create table if not exists public.security_job_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  job_id uuid not null references public.security_jobs(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'JOB_QUEUED', 'JOB_CLAIMED', 'ENGINE_STARTED', 'ENGINE_COMPLETED',
      'ENGINE_FAILED', 'ENGINE_TIMED_OUT', 'ENGINE_CANCELLED',
      'FINDINGS_NORMALIZED', 'EVIDENCE_PERSISTED', 'CORRELATION_COMPLETED',
      'JOB_REJECTED', 'JOB_RETRY_SCHEDULED'
    )
  ),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'security_job_events_tenant_fk'
      and conrelid = 'public.security_job_events'::regclass
  ) then
    alter table public.security_job_events
      add constraint security_job_events_tenant_fk
      foreign key (project_id, organization_id)
      references public.projects (id, organization_id)
      on delete cascade;
  end if;
end
$$;

create index if not exists idx_security_job_events_job
  on public.security_job_events (job_id, created_at);
create index if not exists idx_security_job_events_scan
  on public.security_job_events (scan_id, created_at);

alter table public.security_job_events enable row level security;

drop policy if exists "Members read security job events" on public.security_job_events;
create policy "Members read security job events"
  on public.security_job_events for select
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = security_job_events.organization_id
        and m.user_id = auth.uid()
    )
  );

-- All writes to both tables remain service-role only (no insert/update/
-- delete policy defined) -- matching every other Phase 34/35 table. Only
-- the worker process (holding SUPABASE_SERVICE_ROLE_KEY, never the engine
-- subprocess) and Vercel's server-side job-creation code ever write here.
